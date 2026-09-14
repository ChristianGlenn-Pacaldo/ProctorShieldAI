import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { pusherServer } from "@/lib/pusher";
import { generateGeminiWithFallback } from "@/lib/gemini";
import {
  fallbackVerdict,
  enforceIntegrityPolicy,
  gradeSubmission,
  isIntegrityInvalidated,
  mergeLockedAnswers,
  normalizeSubmittedAnswers,
  parseVerdict,
} from "@/lib/quiz-submission";

import {
  calculateQuizCoinReward,
} from "@/lib/student-coins";
import { ensureStudentGameProfile } from "@/lib/student-game-profile";

class SubmissionConflictError extends Error {}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session || session.role !== "student") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { quizId, answers } = await req.json();
    if (!quizId) {
      return NextResponse.json({ error: "quizId is required" }, { status: 400 });
    }

    // 1. Find the studentQuiz record
    const studentQuiz = await prisma.studentQuiz.findFirst({
      where: {
        studentId: session.userId,
        quizId: Number(quizId),
      },
      include: {
        quiz: true,
        violations: true,
      },
      orderBy: { attemptNumber: "desc" },
    });

    if (!studentQuiz) {
      return NextResponse.json({ error: "Quiz session not found" }, { status: 404 });
    }

    if (!["in_progress", "ended"].includes(studentQuiz.quiz.quizStatus)) {
      return NextResponse.json({ error: "This quiz is not accepting submissions" }, { status: 409 });
    }
    if (studentQuiz.quizStatus === "completed" || studentQuiz.endTime) {
      return NextResponse.json({ error: "This quiz has already been submitted" }, { status: 409 });
    }
    if (["pending_approval", "rejected"].includes(studentQuiz.quizStatus || "")) {
      return NextResponse.json({ error: "You are not approved to submit this quiz" }, { status: 403 });
    }
    if (!studentQuiz.startTime) {
      return NextResponse.json({ error: "Quiz start time is missing" }, { status: 409 });
    }
    const durationMinutes = studentQuiz.quiz.duration ?? 60;
    const deadline = studentQuiz.startTime.getTime() + durationMinutes * 60_000 + 60_000;
    const deadlineExpired = Date.now() > deadline;

    // 2. Dynamic Grading and Saving Answers
    const dbQuestions = await prisma.question.findMany({
      where: { quizId: Number(quizId) },
      include: { choices: true }
    });
    if (dbQuestions.length === 0) {
      return NextResponse.json({ error: "This quiz has no gradable questions" }, { status: 409 });
    }
    // Once time has expired, grade only answers already locked on the server.
    // This finalizes stale attempts without accepting late client-side changes.
    const submittedAnswers = deadlineExpired ? [] : normalizeSubmittedAnswers(answers);
    const persistedLockedAnswers = await prisma.answer.findMany({
      where: { studentQuizId: studentQuiz.id, isCorrect: { not: null } },
      select: { questionId: true, answerText: true },
    });
    const lockedAnswers = persistedLockedAnswers.flatMap((answer) => {
      const choiceId = Number(answer.answerText);
      return Number.isInteger(choiceId) ? [{ questionId: answer.questionId, choiceId }] : [];
    });
    const grading = gradeSubmission(
      dbQuestions,
      mergeLockedAnswers(submittedAnswers, lockedAnswers),
    );
    const score = grading.score;

    // 3. AI Verdict Logic (Gemini with Robust Fallback)
    const violations = studentQuiz.violations;
    const violationSummary = violations.map(v => 
      `- ${v.violationType} (Confidence: ${v.confidenceScore}%) at ${v.timestamp.toISOString()}`
    ).join("\n");

    let verdictData = fallbackVerdict(violations.length);

    // If Gemini key exists, call Gemini for dynamic analysis
    if (process.env.GEMINI_API_KEY) {
      try {
        const prompt = `You are ProctorShield AI, an advanced cheating detection system.
Analyze the following quiz session for a student taking an quiz titled "${studentQuiz.quiz.title}".

Quiz Session Data:
- Duration: ${studentQuiz.quiz.duration} minutes
- Total Violations: ${violations.length}
- Violation Details:
${violationSummary || "No violations recorded."}

Based on this data, provide a verdict. Format your response strictly as a JSON object with the following fields:
- cheatingProbability (number from 0 to 100)
- riskLevel (string: "low", "medium", or "high")
- finalVerdict (string: "clean", "suspicious", or "cheated")
- aiExplanation (string: a concise, 2-3 sentence explanation of the reasoning)

Return ONLY the valid JSON object.`;

        const text = await generateGeminiWithFallback(prompt, true);
        if (text) {
          verdictData = parseVerdict(JSON.parse(text.trim()), verdictData);
        }
      } catch (geminiError) {
        console.warn("Gemini verdict chain failed, using mathematical fallback:", geminiError);
      }
    }

    verdictData = enforceIntegrityPolicy(verdictData, violations.length);
    const integrityInvalidated = isIntegrityInvalidated(violations.length);
    const recordedScore = integrityInvalidated ? null : score;

    const completedAt = new Date();

    // Claim and complete the attempt atomically. A concurrent request cannot
    // pass the conditional update after the first transaction commits.
    let completion;
    try {
      completion = await prisma.$transaction(async (tx) => {
        const claimed = await tx.studentQuiz.updateMany({
          where: {
            id: studentQuiz.id,
            endTime: null,
            quizStatus: { notIn: ["completed", "submitting", "pending_approval", "rejected"] },
            quiz: { quizStatus: { in: ["in_progress", "ended"] } },
          },
          data: { quizStatus: "submitting" },
        });
        if (claimed.count !== 1) throw new SubmissionConflictError();

        await tx.answer.deleteMany({ where: { studentQuizId: studentQuiz.id } });
        if (grading.records.length > 0) {
          await tx.answer.createMany({
            data: grading.records.map((record) => ({ ...record, studentQuizId: studentQuiz.id })),
          });
        }

        await tx.aiAnalysis.upsert({
          where: { studentQuizId: studentQuiz.id },
          update: { totalViolations: violations.length, ...verdictData },
          create: { studentQuizId: studentQuiz.id, totalViolations: violations.length, ...verdictData },
        });

        const completed = await tx.studentQuiz.update({
          where: { id: studentQuiz.id },
          data: {
            endTime: completedAt,
            quizStatus: "completed",
            score: recordedScore,
            ...(integrityInvalidated
              ? { remarks: `Result invalidated after ${violations.length} integrity violations.` }
              : deadlineExpired
                ? { remarks: "Quiz submitted automatically after the time limit expired." }
                : {}),
            aiVerdict: verdictData.finalVerdict,
            cheatingProbability: verdictData.cheatingProbability,
          },
        });

        await tx.notification.createMany({
          data: [
            {
              userId: studentQuiz.quiz.teacherId,
              title: "Quiz Submission Received",
              message: integrityInvalidated
                ? `${session.fullName}'s result for "${studentQuiz.quiz.title}" was invalidated after ${violations.length} integrity violations.`
                : `${session.fullName} submitted "${studentQuiz.quiz.title}" with a score of ${score}%.`,
            },
            {
              userId: session.userId,
              title: "Quiz Completed",
              message: integrityInvalidated
                ? `Your result for "${studentQuiz.quiz.title}" was invalidated because the three-strike integrity limit was reached.`
                : `You completed "${studentQuiz.quiz.title}". Score: ${score}%.`,
            },
          ],
        });
        const allSubmissions = await tx.studentQuiz.findMany({
          where: {
            quizId: Number(quizId),
            quizStatus: "completed",
            aiVerdict: { not: "cheated" },
          },
          select: { id: true, score: true },
          orderBy: [{ score: "desc" }, { endTime: "asc" }],
        });
        const foundIndex = allSubmissions.findIndex((submission) => submission.id === studentQuiz.id);
        const studentRank = foundIndex >= 0 ? foundIndex + 1 : allSubmissions.length + 1;
        const coinReward = calculateQuizCoinReward({
          rank: studentRank,
          score: recordedScore ?? 0,
          violationsCount: violations.length,
          isInvalidated: integrityInvalidated,
        });

        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`student-game-profile:${session.userId}`}))`;
        const currentProfile = await ensureStudentGameProfile(tx, session.userId);
        let totalCoins = currentProfile.coins;
        if (coinReward.coins > 0) {
          await tx.studentCoinLedger.create({
            data: {
              studentId: session.userId,
              sourceType: "quiz-completion",
              sourceId: studentQuiz.id,
              amount: coinReward.coins,
              metadata: {
                quizId: studentQuiz.quiz.id,
                rank: studentRank,
                score: recordedScore,
                violations: violations.length,
              },
            },
          });
          const rewardedProfile = await tx.studentGameProfile.update({
            where: { studentId: session.userId },
            data: {
              coins: { increment: coinReward.coins },
              topOneWins: coinReward.isTopOne ? { increment: 1 } : undefined,
            },
          });
          totalCoins = rewardedProfile.coins;
          await tx.notification.create({
            data: {
              userId: session.userId,
              title: coinReward.isTopOne ? "🥇 Top 1 Leaderboard Champion!" : "🪙 Quiz Coins Earned!",
              message: `You earned +${coinReward.coins} coins for finishing ${coinReward.rankTitle}! Visit the Avatar Shop to unlock new avatars.`,
            },
          });
        }

        return { completed, coinReward, studentRank, totalCoins };
      });
    } catch (error) {
      if (error instanceof SubmissionConflictError) {
        return NextResponse.json({ error: "This quiz is already being submitted or completed" }, { status: 409 });
      }
      throw error;
    }

    const updatedStudentQuiz = completion.completed;

    // Broadcast student-submitted event via Pusher
    const channelName = `private-teacher-${studentQuiz.quiz.teacherId}`;
    try {
      await pusherServer.trigger(channelName, "student-submitted", {
        studentId: session.userId,
        studentName: session.fullName,
        quizId: studentQuiz.quiz.id,
        quizTitle: studentQuiz.quiz.title,
        aiVerdict: verdictData.finalVerdict,
        cheatingProbability: verdictData.cheatingProbability,
        score: recordedScore,
        integrityInvalidated,
        timestamp: new Date().toISOString(),
      });

      // Broadcast to admin dashboard
      await pusherServer.trigger("private-admin-dashboard", "activity", {
        type: "quiz-submit",
        userId: session.userId,
        fullName: session.fullName,
        role: "student",
        activity: `Quiz completed: ${studentQuiz.quiz.title} by ${session.fullName}`,
        timestamp: new Date().toISOString(),
      });
    } catch (pusherErr) {
      console.error("Pusher submit broadcast error:", pusherErr);
    }

    const { coinReward, studentRank, totalCoins } = completion;

    return NextResponse.json({
      success: true,
      studentQuiz: updatedStudentQuiz,
      result: {
        score: recordedScore,
        violationCount: violations.length,
        integrityInvalidated,
        deadlineExpired,
        aiVerdict: verdictData.finalVerdict,
        cheatingProbability: verdictData.cheatingProbability,
        coinsEarned: coinReward.coins,
        rank: studentRank,
        isTopOne: coinReward.isTopOne,
        rankTitle: coinReward.rankTitle,
        totalCoins,
        rewardBreakdown: coinReward.breakdown,
      },
    });

  } catch (error) {
    console.error("Submit quiz error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
