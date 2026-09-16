import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import prisma from "@/lib/prisma";
import {
  computeArenaRankings,
  ensureArenaPlayer,
  getArenaState,
  setArenaState,
} from "@/lib/arena";
import { pusherServer } from "@/lib/pusher";

export async function POST(req: NextRequest) {
  try {
    const session = await getSession("student");
    if (!session || session.role !== "student") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const quizId = Number(body.quizId);
    const questionId = Number(body.questionId);
    const choiceId = Number(body.choiceId);
    if (![quizId, questionId, choiceId].every(Number.isInteger)) {
      return NextResponse.json({ error: "Invalid answer" }, { status: 400 });
    }

    const attempt = await prisma.studentQuiz.findFirst({
      where: {
        studentId: session.userId,
        quizId,
        endTime: null,
        quizStatus: "in_progress",
        quiz: { quizStatus: { in: ["in_progress", "ended"] } },
      },
      select: {
        id: true,
        startTime: true,
        quiz: { select: { duration: true, teacherId: true } },
      },
      orderBy: { attemptNumber: "desc" },
    });
    if (!attempt?.startTime) {
      return NextResponse.json({ error: "Active quiz session not found" }, { status: 409 });
    }

    const deadline = attempt.startTime.getTime() + (attempt.quiz.duration ?? 60) * 60_000 + 60_000;
    if (Date.now() > deadline) {
      return NextResponse.json({ error: "The answer deadline has passed" }, { status: 409 });
    }

    const selectedChoice = await prisma.choice.findFirst({
      where: { id: choiceId, questionId, question: { quizId } },
      select: { id: true, isCorrect: true, question: { select: { points: true } } },
    });
    if (!selectedChoice) {
      return NextResponse.json({ error: "That choice does not belong to this question" }, { status: 400 });
    }

    const result = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`quiz-answer:${attempt.id}:${questionId}`}))`;
      const existing = await tx.answer.findUnique({
        where: { studentQuizId_questionId: { studentQuizId: attempt.id, questionId } },
        select: { answerText: true, isCorrect: true },
      });

      if (existing?.isCorrect !== null && existing?.isCorrect !== undefined) {
        return {
          choiceId: Number(existing.answerText),
          isCorrect: existing.isCorrect,
          alreadyAnswered: true,
        };
      }

      await tx.answer.upsert({
        where: { studentQuizId_questionId: { studentQuizId: attempt.id, questionId } },
        update: {
          answerText: String(choiceId),
          isCorrect: selectedChoice.isCorrect,
          pointsEarned: selectedChoice.isCorrect ? selectedChoice.question.points : 0,
        },
        create: {
          studentQuizId: attempt.id,
          questionId,
          answerText: String(choiceId),
          isCorrect: selectedChoice.isCorrect,
          pointsEarned: selectedChoice.isCorrect ? selectedChoice.question.points : 0,
        },
      });
      await tx.studentQuiz.update({
        where: { id: attempt.id },
        data: { lastHeartbeatAt: new Date() },
      });

      return { choiceId, isCorrect: selectedChoice.isCorrect, alreadyAnswered: false };
    }, { timeout: 15_000 });

    let updatedScore = 0;
    let updatedRank = 1;
    let totalCount = 1;

    if (!result.alreadyAnswered) {
      try {
        const arena = await getArenaState(quizId);
        if (arena?.status === "active" && arena.teacherId === attempt.quiz.teacherId) {
          const participant = ensureArenaPlayer(arena, {
            studentId: session.userId,
            studentName: session.fullName,
          });

          const points = result.isCorrect ? (selectedChoice.question.points || 100) : 0;
          participant.score += points;
          participant.questionsAnswered += 1;
          if (arena.totalQuestions > 0 && participant.questionsAnswered >= arena.totalQuestions) {
            participant.isFinished = true;
            participant.finishedAt = new Date().toISOString();
          }

          const ranked = computeArenaRankings(arena.participants);
          await setArenaState(arena);

          updatedScore = participant.score;
          updatedRank = participant.rank;
          totalCount = ranked.length;

          await Promise.allSettled([
            pusherServer.trigger(`private-arena-${quizId}`, "arena-score-updated", {
              quizId,
              studentId: session.userId,
              score: participant.score,
              rank: participant.rank,
              totalCount: ranked.length,
              questionsAnswered: participant.questionsAnswered,
              totalQuestions: arena.totalQuestions,
              isFinished: participant.isFinished,
              timestamp: new Date().toISOString(),
            }),
            pusherServer.trigger(`private-arena-${quizId}`, "arena-leaderboard-updated", {
              quizId,
              participants: ranked,
              updatedStudentId: session.userId,
            }),
            pusherServer.trigger(`private-teacher-${attempt.quiz.teacherId}`, "arena-answer", {
              sessionId: arena.sessionId,
              studentId: session.userId,
              studentName: session.fullName,
              questionId,
              choiceId: result.choiceId,
              isCorrect: result.isCorrect,
              score: participant.score,
              rank: participant.rank,
              questionsAnswered: participant.questionsAnswered,
              isFinished: participant.isFinished,
              timestamp: new Date().toISOString(),
            }),
          ]);
        }
      } catch (error) {
        console.warn("Arena answer broadcast warning:", error);
      }
    }

    return NextResponse.json({
      success: true,
      ...result,
      score: updatedScore,
      rank: updatedRank,
      totalCount,
    });
  } catch (error) {
    console.error("Record quiz answer error:", error);
    return NextResponse.json({ error: "Failed to record answer" }, { status: 500 });
  }
}
