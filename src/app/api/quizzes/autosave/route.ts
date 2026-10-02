import { recoverArenaFinalization } from "@/lib/arena-finalization";
import { withBackupWriteGate } from "@/lib/backup-write-gate";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { mutateArena } from "@/lib/arena";
import { normalizeSubmittedAnswers } from "@/lib/quiz-submission";

class AutosaveConflictError extends Error {}

async function POSTImpl(req: NextRequest) {
  try {
    const session = await getSession("student");
    if (!session || session.role !== "student") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const quizId = Number(body.quizId);
    const answers = normalizeSubmittedAnswers(body.answers).slice(0, 500);
    if (!Number.isInteger(quizId)) {
      return NextResponse.json({ error: "Invalid quiz" }, { status: 400 });
    }

    const studentQuiz = await prisma.studentQuiz.findFirst({
      where: {
        studentId: session.userId,
        quizId,
        endTime: null,
        quizStatus: "in_progress",
        quiz: { quizStatus: { in: ["in_progress", "ended"] } },
      },
      select: { id: true, startTime: true, attemptMode: true, quiz: { select: { duration: true } } },
      orderBy: { attemptNumber: "desc" },
    });
    if (!studentQuiz || !studentQuiz.startTime || (studentQuiz.attemptMode !== "arena" && body.studentQuizId !== studentQuiz.id)) {
      return NextResponse.json({ error: "Active quiz session not found" }, { status: 409 });
    }

    const deadline = studentQuiz.startTime.getTime() + (studentQuiz.quiz.duration ?? 60) * 60_000 + 60_000;
    if (studentQuiz.attemptMode !== "arena" && Date.now() > deadline) {
      return NextResponse.json({ error: "The autosave deadline has passed" }, { status: 409 });
    }

    const choices = answers.length === 0
      ? []
      : await prisma.choice.findMany({
          where: {
            id: { in: answers.map((answer) => answer.choiceId) },
            question: { quizId },
          },
          select: { id: true, questionId: true },
        });
    const allowed = new Map(choices.map((choice) => [choice.questionId, choice.id]));
    const accepted = answers.filter((answer) => allowed.get(answer.questionId) === answer.choiceId);
    const savedAt = new Date();

    const saveAnswers = async (tx: import("@prisma/client").Prisma.TransactionClient) => {
      const heartbeat = await tx.studentQuiz.updateMany({
        where: {
          id: studentQuiz.id,
          endTime: null,
          quizStatus: "in_progress",
          quiz: { quizStatus: { in: ["in_progress", "ended"] } },
        },
        data: { lastHeartbeatAt: savedAt },
      });
      if (heartbeat.count !== 1) throw new AutosaveConflictError();

      for (const answer of accepted) {
        const existing = await tx.answer.findUnique({
          where: {
            studentQuizId_questionId: {
              studentQuizId: studentQuiz.id,
              questionId: answer.questionId,
            },
          },
          select: { isCorrect: true },
        });
        if (existing?.isCorrect !== null && existing?.isCorrect !== undefined) continue;
        await tx.answer.upsert({
          where: {
            studentQuizId_questionId: {
              studentQuizId: studentQuiz.id,
              questionId: answer.questionId,
            },
          },
          update: {
            answerText: String(answer.choiceId),
            isCorrect: null,
            pointsEarned: null,
          },
          create: {
            studentQuizId: studentQuiz.id,
            questionId: answer.questionId,
            answerText: String(answer.choiceId),
          },
        });
      }
    };
    if (studentQuiz.attemptMode === "arena") {
      const saved = await mutateArena(quizId, async (mutation) => {
        const { tx, state } = mutation;
        if (state?.participants[session.userId] && (typeof body.sessionId !== "string" || body.sessionId === state.sessionId)) await recoverArenaFinalization(mutation);
        if (!state || state.status !== "active" || !state.participants[session.userId]
          || (state.matchEndsAt && Date.now() >= Date.parse(state.matchEndsAt))
          || (typeof body.sessionId === "string" && body.sessionId !== state.sessionId)) return false;
        await saveAnswers(tx);
        return true;
      });
      if (!saved) throw new AutosaveConflictError();
    } else {
      await prisma.$transaction(saveAnswers);
    }

    return NextResponse.json({ success: true, savedCount: accepted.length, savedAt });
  } catch (error) {
    if (error instanceof AutosaveConflictError) {
      return NextResponse.json({ error: "Quiz is being submitted or has ended" }, { status: 409 });
    }
    console.error("Quiz autosave error:", error);
    return NextResponse.json({ error: "Failed to autosave answers" }, { status: 500 });
  }
}

export const POST = withBackupWriteGate(POSTImpl);
