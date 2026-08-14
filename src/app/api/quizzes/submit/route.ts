import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { pusherServer } from "@/lib/pusher";
import { generateGeminiWithFallback } from "@/lib/gemini";

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
    });

    if (!studentQuiz) {
      return NextResponse.json({ error: "Quiz session not found" }, { status: 404 });
    }

    // 2. Dynamic Grading and Saving Answers
    const dbQuestions = await prisma.question.findMany({
      where: { quizId: Number(quizId) },
      include: { choices: true }
    });

    let score = 0;
    if (dbQuestions.length > 0) {
      let totalPoints = 0;
      let earnedPoints = 0;
      for (const q of dbQuestions) {
        totalPoints += q.points;
        const submitted = answers?.find((a: any) => a.questionId === q.id);
        const correctChoice = q.choices.find(c => c.isCorrect);
        const isCorrect = submitted && correctChoice && submitted.choiceId === correctChoice.id;
        if (isCorrect) {
          earnedPoints += q.points;
        }
      }
      score = totalPoints > 0 ? Math.round((earnedPoints / totalPoints) * 100) : 0;

      // Save student answers to the database
      if (answers && answers.length > 0) {
        try {
          await prisma.answer.deleteMany({
            where: { studentQuizId: studentQuiz.id }
          });

          await prisma.answer.createMany({
            data: answers.map((a: any) => {
              const q = dbQuestions.find(dq => dq.id === a.questionId);
              const correctChoice = q?.choices.find(c => c.isCorrect);
              const isCorrect = q && correctChoice && a.choiceId === correctChoice.id;
              return {
                studentQuizId: studentQuiz.id,
                questionId: a.questionId,
                pointsEarned: isCorrect ? q.points : 0,
                isCorrect: isCorrect,
                answerText: String(a.choiceId)
              };
            })
          });
        } catch (err) {
          console.error("Failed to save student answers:", err);
        }
      }
    } else {
      // Fallback for legacy/mock quizzes
      score = Math.floor(75 + Math.random() * 25);
    }

    // 3. AI Verdict Logic (Gemini with Robust Fallback)
    const violations = studentQuiz.violations;
    const violationSummary = violations.map(v => 
      `- ${v.violationType} (Confidence: ${v.confidenceScore}%) at ${v.timestamp.toISOString()}`
    ).join("\n");

    let verdictData = {
      cheatingProbability: 3,
      riskLevel: "low",
      finalVerdict: "clean",
      aiExplanation: "No anomalies detected during the quiz session. Student maintained focus.",
    };

    if (violations.length === 0) {
      verdictData = {
        cheatingProbability: 0,
        riskLevel: "low",
        finalVerdict: "clean",
        aiExplanation: "No anomalies detected during the quiz session. Student maintained full focus.",
      };
    } else if (violations.length === 1) {
      verdictData = {
        cheatingProbability: 45,
        riskLevel: "medium",
        finalVerdict: "suspicious",
        aiExplanation: "A proctoring anomaly was recorded during the session. Instructors should review evidence logs.",
      };
    } else if (violations.length === 2) {
      verdictData = {
        cheatingProbability: 85,
        riskLevel: "high",
        finalVerdict: "cheated",
        aiExplanation: `Multiple integrity violations (${violations.length}) were flagged during the quiz session.`,
      };
    } else if (violations.length >= 3) {
      verdictData = {
        cheatingProbability: 100,
        riskLevel: "high",
        finalVerdict: "cheated",
        aiExplanation: `Maximum violation threshold reached (${violations.length} violations). High confidence of cheating activity.`,
      };
    }

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
          const parsed = JSON.parse(text.trim());
          if (parsed && parsed.finalVerdict) {
            verdictData = parsed;
          }
        }
      } catch (geminiError) {
        console.warn("Gemini verdict chain failed, using mathematical fallback:", geminiError);
      }
    }

    // 4. Save AI Analysis Verdict to Database
    await prisma.aiAnalysis.upsert({
      where: { studentQuizId: studentQuiz.id },
      update: {
        totalViolations: violations.length,
        cheatingProbability: verdictData.cheatingProbability,
        riskLevel: verdictData.riskLevel,
        finalVerdict: verdictData.finalVerdict,
        aiExplanation: verdictData.aiExplanation,
      },
      create: {
        studentQuizId: studentQuiz.id,
        totalViolations: violations.length,
        cheatingProbability: verdictData.cheatingProbability,
        riskLevel: verdictData.riskLevel,
        finalVerdict: verdictData.finalVerdict,
        aiExplanation: verdictData.aiExplanation,
      },
    });

    // 5. Update StudentQuiz Status and Verdict
    const updatedStudentQuiz = await prisma.studentQuiz.update({
      where: { id: studentQuiz.id },
      data: {
        endTime: new Date(),
        quizStatus: "completed",
        score: score,
        aiVerdict: verdictData.finalVerdict,
        cheatingProbability: verdictData.cheatingProbability,
      },
    });

    // Broadcast student-submitted event via Pusher
    const channelName = `teacher-${studentQuiz.quiz.teacherId}`;
    try {
      // Save notification to DB for Teacher
      await prisma.notification.create({
        data: {
          userId: studentQuiz.quiz.teacherId,
          title: "Quiz Submission Received",
          message: `${session.fullName} submitted "${studentQuiz.quiz.title}" with a score of ${score}%.`,
        },
      });

      // Save notification to DB for Student
      await prisma.notification.create({
        data: {
          userId: session.userId,
          title: "Quiz Completed",
          message: `You completed "${studentQuiz.quiz.title}". Score: ${score}%.`,
        },
      });

      await pusherServer.trigger(channelName, "student-submitted", {
        studentId: session.userId,
        studentName: session.fullName,
        quizId: studentQuiz.quiz.id,
        quizTitle: studentQuiz.quiz.title,
        aiVerdict: verdictData.finalVerdict,
        cheatingProbability: verdictData.cheatingProbability,
        score: score,
        timestamp: new Date().toISOString(),
      });

      // Broadcast to admin dashboard
      await pusherServer.trigger("admin-dashboard", "activity", {
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

    return NextResponse.json({
      success: true,
      studentQuiz: updatedStudentQuiz,
    });

  } catch (error) {
    console.error("Submit quiz error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
