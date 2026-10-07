import { recoverArenaFinalization } from "@/lib/arena-finalization";
import { withBackupWriteGate } from "@/lib/backup-write-gate";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { readProctoredSession, sessionTimingPayload } from "@/lib/quiz-session-timing";
import { readArenaQuestionWork, saveArenaRetryState } from "@/lib/arena-question-work";
import { arenaRealtime } from "@/lib/arena-realtime";
import { computeArenaRankings, ensureArenaPlayer, mutateArena } from "@/lib/arena";
class AnswerConflictError extends Error {
}
// Build JSON after commit so the body carries its committed Arena revision.
function jsonAfterCommit(body: unknown, init?: ResponseInit) {
  return () => NextResponse.json(body, init);
}
async function POSTImpl(req: NextRequest) {
  try {
    const session = await getSession("student");
    if (!session || session.role !== "student") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const body = await req.json();
    const quizId = Number(body.quizId);
    const questionId = Number(body.questionId);
    let choiceId = Number(body.choiceId);
    const textAnswer = typeof body.textAnswer === "string" ? body.textAnswer.trim().slice(0, 2000) : null;
    if (![quizId, questionId].every(Number.isInteger) || (textAnswer === null && !Number.isInteger(choiceId))) {
      return NextResponse.json({ error: "Invalid answer" }, { status: 400 });
    }
    const reply = await mutateArena(quizId, async (mutation) => {
      const prisma = mutation.tx;
      const realtime = arenaRealtime(mutation);
      const arena = mutation.state;
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
          attemptMode: true,
          quiz: { select: { id: true, duration: true, teacherId: true, quizStatus: true, quizMode: true, questions: { select: { id: true } } } },
        },
        orderBy: { attemptNumber: "desc" },
      });
      if (!attempt?.startTime || (attempt.attemptMode !== "arena" && body.studentQuizId !== attempt.id)) {
        return jsonAfterCommit({ error: "Active quiz session not found" }, { status: 409 });
      }
      if (attempt.attemptMode === "arena" && arena?.participants[session.userId]
        && (typeof body.sessionId !== "string" || body.sessionId === arena.sessionId)) {
        await recoverArenaFinalization(mutation);
      }
      const timing = attempt.attemptMode === "arena" ? null : await readProctoredSession(prisma, attempt.quiz);
      if (attempt.attemptMode !== "arena" && (!timing || sessionTimingPayload(timing, attempt.quiz.quizStatus).remainingSeconds === 0)) {
        return jsonAfterCommit({ error: "The answer deadline has passed" }, { status: 409 });
      }
      if (textAnswer !== null && attempt.attemptMode !== "arena") {
        const question = await prisma.question.findFirst({ where: { id: questionId, quizId, questionType: "fill_in_blank" }, include: { choices: true } });
        if (!question || !textAnswer)
          return jsonAfterCommit({ error: "Invalid text answer" }, { status: 400 });
        const match = question.choices.find((choice) => choice.isCorrect && choice.choiceText.trim().toLowerCase() === textAnswer.toLowerCase());
        const selected = match || question.choices.find((choice) => !choice.isCorrect);
        choiceId = selected?.id ?? 0;
      }
      const wrongTextQuestion = textAnswer !== null && choiceId === 0
        ? await prisma.question.findFirst({ where: { id: questionId, quizId, questionType: "fill_in_blank" }, select: { points: true } }) : null;
      const selectedChoice = wrongTextQuestion ? { id: 0, isCorrect: false, question: wrongTextQuestion } : await prisma.choice.findFirst({
        where: { id: choiceId, questionId, question: { quizId } },
        select: { id: true, isCorrect: true, question: { select: { points: true } } },
      });
      if (!selectedChoice) {
        return jsonAfterCommit({ error: "That choice does not belong to this question" }, { status: 400 });
      }
      if (attempt.attemptMode === "arena") {
        if (!arena || arena.status !== "active" || arena.teacherId !== attempt.quiz.teacherId
          || attempt.quiz.quizStatus !== "in_progress" || attempt.quiz.quizMode !== "arena"
          || (arena.matchEndsAt && Date.now() >= Date.parse(arena.matchEndsAt))) {
          return jsonAfterCommit({ error: "Arena match is no longer active", code: "ARENA_ENDED" }, { status: 409 });
        }
        if (typeof body.sessionId === "string" && body.sessionId !== arena.sessionId) {
          return jsonAfterCommit({ error: "Stale Arena session", code: "STALE_ARENA_SESSION" }, { status: 409 });
        }
        if (!arena.participants[session.userId]) {
          return jsonAfterCommit({ error: "Join the current Arena session first", code: "NOT_ARENA_PARTICIPANT" }, { status: 409 });
        }
      }
      const recordAnswer = async () => {
        const tx = prisma;
        await tx.$executeRaw `SELECT pg_advisory_xact_lock(hashtext(${`quiz-answer:${attempt.id}:${questionId}`}))`;
        {
          const active = await tx.studentQuiz.updateMany({
            where: { id: attempt.id, endTime: null, quizStatus: "in_progress" },
            data: { lastHeartbeatAt: new Date() },
          });
          if (active.count !== 1)
            throw new AnswerConflictError();
        }
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
      };
      let questionWork: Awaited<ReturnType<typeof readArenaQuestionWork>>["work"] | undefined;
      const answerKind = body.answerKind ?? "initial";
      let result: { choiceId: number; isCorrect: boolean; alreadyAnswered: boolean };
      if (attempt.attemptMode === "arena" && arena) {
        if (!["initial", "retry"].includes(answerKind)) return jsonAfterCommit({ error: "Invalid Arena answer kind" }, { status: 400 });
        if (body.studentQuizId !== undefined && body.studentQuizId !== attempt.id) return jsonAfterCommit({ error: "Stale attempt" }, { status: 409 });
        const progress = await readArenaQuestionWork(prisma, attempt.id, arena.sessionId, attempt.quiz.questions);
        if (arena.matchEndsAt && Date.now() >= Date.parse(arena.matchEndsAt)) {
          return jsonAfterCommit({ error: "Arena match is no longer active", code: "ARENA_ENDED" }, { status: 409 });
        }
        if (answerKind === "retry") {
          const previous = progress.state.retryAnswers[questionId];
          if (previous) result = { choiceId: previous.choiceId, isCorrect: previous.isCorrect, alreadyAnswered: true };
          else {
            if (progress.work.nextWork?.kind !== "retry" || progress.work.nextWork.questionId !== questionId) {
              return jsonAfterCommit({ error: "This delayed retry is not available", code: "RETRY_NOT_READY" }, { status: 409 });
            }
            const active = await prisma.studentQuiz.updateMany({ where: { id: attempt.id, endTime: null, quizStatus: "in_progress" }, data: { lastHeartbeatAt: new Date() } });
            if (active.count !== 1) throw new AnswerConflictError();
            if (arena.matchEndsAt && Date.now() >= Date.parse(arena.matchEndsAt)) {
              return jsonAfterCommit({ error: "Arena match is no longer active", code: "ARENA_ENDED" }, { status: 409 });
            }
            progress.state.retryAnswers[questionId] = { questionId, choiceId, isCorrect: selectedChoice.isCorrect, answeredAt: new Date().toISOString() };
            progress.state.lastQuestionId = questionId;
            await saveArenaRetryState(prisma, progress.state);
            result = { choiceId, isCorrect: selectedChoice.isCorrect, alreadyAnswered: false };
          }
        } else {
          result = await recordAnswer();
          if (!result.alreadyAnswered) {
            progress.state.lastQuestionId = questionId;
            await saveArenaRetryState(prisma, progress.state);
          }
        }
        questionWork = (await readArenaQuestionWork(prisma, attempt.id, arena.sessionId, attempt.quiz.questions)).work;
      } else result = await recordAnswer();
      let updatedScore = arena?.participants[session.userId]?.score ?? 0;
      let updatedRank = arena?.participants[session.userId]?.rank ?? 1;
      let totalCount = arena ? Object.keys(arena.participants).length : 1;
      if (attempt.attemptMode === "arena" && !result.alreadyAnswered && arena) {
        const participant = ensureArenaPlayer(arena, {
          studentId: session.userId,
          studentName: session.fullName,
        });
        const points = answerKind === "initial" && result.isCorrect ? (selectedChoice.question.points || 100) : 0;
        participant.score += points;
        participant.questionsAnswered = questionWork!.originalAnswered;
        participant.correctCount = questionWork!.correctCount; participant.wrongCount = questionWork!.wrongCount;
        participant.retryCorrectCount = questionWork!.retryCorrectCount; participant.retryWrongCount = questionWork!.retryWrongCount;
        participant.isFinished = questionWork!.isFinished;
        if (participant.isFinished) participant.finishedAt = new Date().toISOString();
        const ranked = computeArenaRankings(arena.participants);
        updatedScore = participant.score;
        updatedRank = participant.rank;
        totalCount = ranked.length;
        await Promise.allSettled([
          realtime.trigger(`private-arena-${quizId}`, "arena-score-updated", {
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
          realtime.trigger(`private-arena-${quizId}`, "arena-leaderboard-updated", {
            quizId,
            participants: ranked,
            updatedStudentId: session.userId,
          }),
          realtime.trigger(`private-teacher-${attempt.quiz.teacherId}`, "arena-answer", {
            sessionId: arena.sessionId,
            studentId: session.userId,
            studentName: session.fullName,
            questionId,
            answerKind,
            correctCount: participant.correctCount, wrongCount: participant.wrongCount,
            retryCorrectCount: participant.retryCorrectCount, retryWrongCount: participant.retryWrongCount,
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
      const response = {
        success: true,
        ...result,
        score: updatedScore,
        rank: updatedRank,
        totalCount,
        ...(questionWork ? { questionWork, answerKind } : {}),
      };
      return () => NextResponse.json({ ...response, ...(attempt.attemptMode === "arena" && arena ? {
        quizId, arenaRevision: arena.revision, sessionId: arena.sessionId, status: arena.status,
        participants: computeArenaRankings(arena.participants), usedPowers: arena.usedPowers[session.userId] ?? {},
      } : {}) });
    });
    return reply();
  }
  catch (error) {
    if (error instanceof AnswerConflictError)
      return NextResponse.json({ error: "Attempt is already completed" }, { status: 409 });
    console.error("Record quiz answer error:", error);
    return NextResponse.json({ error: "Failed to record answer" }, { status: 500 });
  }
}
export const POST = withBackupWriteGate(POSTImpl);
