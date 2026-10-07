import { withBackupWriteGate } from "@/lib/backup-write-gate";
import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { getAttemptQuestionOrder, shuffleArray } from "@/lib/quiz-question-order";
import prisma from "@/lib/prisma";
import { mutateArena } from "@/lib/arena";
import type { Prisma } from "@prisma/client";
import { getSession } from "@/lib/auth";
import { canStudentEnterQuiz } from "@/lib/quiz-access";
import { readProctoredSession, sessionTimingPayload } from "@/lib/quiz-session-timing";
import { parseQuizMode, InvalidQuizModeError, canChangeQuizMode, type QuizMode } from "@/lib/quiz-mode";
import {
  DELETED_QUIZ_STATUS,
  isQuizAvailable,
  quizNotAvailableResponse,
} from "@/lib/quiz-availability";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const quizId = parseInt(id);

    const quiz = await prisma.quiz.findUnique({
      where: { id: quizId },
      include: {
        subject: true,
        questions: {
          orderBy: { id: "asc" },
          include: {
            choices: { orderBy: { id: "asc" } }
          }
        }
      }
    });

    if (!quiz) {
      return NextResponse.json({ error: "Quiz not found" }, { status: 404 });
    }

    if (!isQuizAvailable(quiz.quizStatus)) {
      return NextResponse.json(quizNotAvailableResponse(), { status: 410 });
    }

    if (session.role === "teacher" && quiz.teacherId !== session.userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    let attemptsCount = 0;
    if (session.role === "teacher") {
      attemptsCount = await prisma.studentQuiz.count({
        where: { quizId: quiz.id },
      });
    }

    // There is no authored-position column. Persisted IDs provide the canonical
    // creation order; never seed a shuffle from an unspecified relation order.
    let questions = [...quiz.questions].sort((a, b) => a.id - b.id).map((question) => ({
      ...question,
      choices: [...question.choices].sort((a, b) => a.id - b.id),
    }));
    let studentQuiz: Awaited<ReturnType<typeof prisma.studentQuiz.findFirst>> = null;

    // Check permissions and apply shuffling/stripping for students
    if (session.role === "student") {
      studentQuiz = await prisma.studentQuiz.findFirst({
        where: {
          studentId: session.userId,
          quizId: quiz.id
        },
        orderBy: { attemptNumber: "desc" },
      });

      if (!studentQuiz) {
        return NextResponse.json({ error: "You are not enrolled in this quiz" }, { status: 403 });
      }

      if (quiz.quizStatus === "ended" && !studentQuiz.endTime && studentQuiz.quizStatus !== "in_progress" && !(studentQuiz.quizStatus === "enrolled" && studentQuiz.attemptNumber > 1)) {
        return NextResponse.json({ error: "This quiz has already ended." }, { status: 403 });
      }

      const canEnterQuiz = canStudentEnterQuiz({
        quizStatus: quiz.quizStatus,
        studentQuizStatus: studentQuiz.quizStatus,
        startTime: studentQuiz.startTime,
        endTime: studentQuiz.endTime,
      });

      // Every attempt gets its own stable server-owned question order.
      questions = getAttemptQuestionOrder(questions, studentQuiz.id);
      if (quiz.shuffleQuestions) {
        // Preserve the existing opt-in choice shuffle without expanding it to Arena.
        // Also shuffle choices for each question deterministically
        questions = questions.map((q) => ({
          ...q,
          choices: shuffleArray(q.choices, `${studentQuiz!.id}-${q.id}`)
        }));
      }
    }

    const canEnterQuiz = session.role === "student"
      ? canStudentEnterQuiz({
          quizStatus: quiz.quizStatus,
          studentQuizStatus: studentQuiz?.quizStatus,
          startTime: studentQuiz?.startTime,
          endTime: studentQuiz?.endTime,
        })
      : true;
    const canStartProctored = session.role === "student" && quiz.quizMode !== "arena"
      && studentQuiz?.quizStatus === "enrolled" && !studentQuiz.endTime
      && quiz.quizStatus === "in_progress";
    const safeQuestions = session.role === "student" && !canEnterQuiz && !canStartProctored ? [] : questions;
    const savedAnswers = session.role === "student" && studentQuiz && canEnterQuiz
      ? await prisma.answer.findMany({
          where: { studentQuizId: studentQuiz.id },
          select: { questionId: true, answerText: true, isCorrect: true },
        })
      : [];
    const violationCount = session.role === "student" && studentQuiz
      ? await prisma.violation.count({ where: { studentQuizId: studentQuiz.id } })
      : undefined;
    const teacherEnd = session.role === "student" && quiz.quizMode !== "arena" && quiz.quizStatus === "ended"
      ? await prisma.setting.findUnique({ where: { settingKey: `proctored:quiz-ended:${quiz.id}` } }) : null;
    const timing = session.role === "student" && quiz.quizMode !== "arena"
      ? await readProctoredSession(prisma, quiz) : null;
    const clock = timing ? sessionTimingPayload(timing, quiz.quizStatus) : null;
    const remainingSeconds = clock?.remainingSeconds;

    return NextResponse.json({
      success: true,
      userId: session.userId,
      studentQuizStatus: session.role === "student" ? studentQuiz?.quizStatus : undefined,
      studentQuizId: session.role === "student" ? studentQuiz?.id : undefined,
      attemptMode: session.role === "student" ? studentQuiz?.attemptMode || "proctored" : undefined,
      canEnterQuiz: session.role === "student" ? canEnterQuiz || canStartProctored : undefined,
      startTime: studentQuiz?.startTime,
      endTime: studentQuiz?.endTime,
      attemptNumber: studentQuiz?.attemptNumber,
      ...clock,
      remainingSeconds,
      teacherEndedAt: teacherEnd?.settingValue || null,
      deviceType: session.role === "student" ? studentQuiz?.deviceType : undefined,
      monitoringLevel: session.role === "student" ? studentQuiz?.monitoringLevel : undefined,
      violationCount: session.role === "student" ? Math.min(violationCount ?? 0, 3) : undefined,
      savedAnswers: savedAnswers.flatMap((answer) => {
        const choiceId = Number(answer.answerText);
        return Number.isInteger(choiceId)
          ? [{ questionId: answer.questionId, choiceId, isCorrect: answer.isCorrect }]
          : [];
      }),
      quiz: {
        id: quiz.id,
        title: quiz.title,
        description: quiz.description,
        quizMode: quiz.quizMode || "proctored",
        duration: quiz.duration,
        totalQuestions: quiz.totalQuestions || quiz.questions.length,
        passingScore: quiz.passingScore,
        shuffleQuestions: quiz.shuffleQuestions,
        quizStatus: quiz.quizStatus,
        teacherId: quiz.teacherId,
        subject: quiz.subject,
        hasAttempts: attemptsCount > 0,
        attemptsCount,
      },
      questions: safeQuestions.map(q => ({
        id: q.id,
        questionText: q.questionText,
        questionType: q.questionType,
        points: q.points,
        choices: q.choices.map(c => ({
          id: c.id,
          choiceText: c.choiceText,
          // Exclude correct choice information from student network responses
          ...(session.role !== "student" ? { isCorrect: c.isCorrect } : {})
        }))
      }))
    }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });

  } catch (error) {
    console.error("Get quiz details error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}


function validateEditedQuestions(rawQuestions: unknown) {
  if (!Array.isArray(rawQuestions) || rawQuestions.length === 0 || rawQuestions.length > 100) {
    return { error: "Add between 1 and 100 complete questions" };
  }

  const questions: Array<{
    questionText: string;
    questionType: string;
    points: number;
    choices: { create: Array<{ choiceText: string; isCorrect: boolean }> };
  }> = [];

  for (const rawQuestion of rawQuestions) {
    if (!rawQuestion || typeof rawQuestion !== "object" || Array.isArray(rawQuestion)) {
      return { error: "Every question needs complete text of at most 2000 characters" };
    }
    const question = rawQuestion as Record<string, unknown>;
    if (typeof question.questionText !== "string" || !question.questionText.trim() || question.questionText.length > 2_000) {
      return { error: "Every question needs complete text of at most 2000 characters" };
    }

    const points = question.points === undefined ? 1 : question.points;
    if (typeof points !== "number" || !Number.isInteger(points) || points < 1 || points > 100) {
      return { error: "Question points must be whole numbers between 1 and 100" };
    }

    if (!Array.isArray(question.choices) || question.choices.length > 10) {
      return { error: "Every question needs complete answers (at most 10 choices)" };
    }
    const choices: Array<{ choiceText: string; isCorrect: boolean }> = [];
    for (const rawChoice of question.choices) {
      if (!rawChoice || typeof rawChoice !== "object" || Array.isArray(rawChoice)) {
        return { error: "Every answer needs text of at most 1000 characters" };
      }
      const choice = rawChoice as Record<string, unknown>;
      if (typeof choice.choiceText !== "string" || !choice.choiceText.trim() || choice.choiceText.length > 1_000) {
        return { error: "Every answer needs text of at most 1000 characters" };
      }
      choices.push({ choiceText: choice.choiceText.trim(), isCorrect: Boolean(choice.isCorrect) });
    }

    const questionType = typeof question.questionType === "string" ? question.questionType.slice(0, 50) : "multiple_choice";
    const correctCount = choices.filter((choice) => choice.isCorrect).length;
    if (questionType === "fill_in_blank" ? choices.length < 1 || correctCount < 1 : choices.length < 2 || correctCount !== 1) {
      return { error: "Every question must have complete answers and a correct answer marked" };
    }

    questions.push({
      questionText: question.questionText.trim(),
      questionType,
      points,
      choices: { create: choices },
    });
  }

  return { questions };
}

async function PUTImpl(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session || session.role !== "teacher") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const quizId = parseInt(id);
    const body = await req.json();

    if (!Number.isInteger(quizId) || !body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid quiz update" }, { status: 400 });
    }

    const existingQuiz = await prisma.quiz.findUnique({
      where: { id: quizId },
    });

    if (!existingQuiz || existingQuiz.teacherId !== session.userId) {
      return NextResponse.json({ error: "Quiz not found or unauthorized" }, { status: 404 });
    }
    if (!isQuizAvailable(existingQuiz.quizStatus)) {
      return NextResponse.json(quizNotAvailableResponse(), { status: 410 });
    }

    const requestedStatus = body.quizStatus;
    if (requestedStatus !== undefined) {
      const allowedTransitions: Record<string, string[]> = {
        draft: ["active"],
        active: ["draft"],
        in_progress: ["ended"],
        ended: [],
      };
      if (
        typeof requestedStatus !== "string"
        || !allowedTransitions[existingQuiz.quizStatus]?.includes(requestedStatus)
      ) {
        return NextResponse.json(
          { error: "Invalid quiz status transition. Use the Start action to begin a quiz." },
          { status: 409 },
        );
      }
    }

    let requestedDuration: number | undefined;
    if (body.duration !== undefined) {
      requestedDuration = Number(body.duration);
      if ((typeof body.duration !== "number" && typeof body.duration !== "string") || !Number.isInteger(requestedDuration) || requestedDuration < 1 || requestedDuration > 480) {
        return NextResponse.json({ error: "Duration must be between 1 and 480 minutes" }, { status: 400 });
      }
      if (["in_progress", "ended"].includes(existingQuiz.quizStatus)) {
        return NextResponse.json({ error: "Duration cannot be changed after a quiz starts" }, { status: 409 });
      }
    }
    if (body.allowRetake !== undefined && typeof body.allowRetake !== "boolean") {
      return NextResponse.json({ error: "allowRetake must be a boolean" }, { status: 400 });
    }
    const subjectName = typeof body.subjectName === "string" ? body.subjectName.trim() : undefined;
    if (body.subjectName !== undefined && (!subjectName || subjectName.length > 150)) {
      return NextResponse.json({ error: "Subject name is required and must be at most 150 characters" }, { status: 400 });
    }

    const title = typeof body.title === "string" && body.title.trim() ? body.title.trim() : undefined;
    const description = typeof body.description === "string" ? body.description.trim() : undefined;
    const passingScore = typeof body.passingScore === "number" ? Math.max(0, Math.min(100, body.passingScore)) : undefined;
    const shuffleQuestions = typeof body.shuffleQuestions === "boolean" ? body.shuffleQuestions : undefined;
    const isGamified = typeof body.isGamified === "boolean" ? body.isGamified : undefined;

    let parsedQuizMode: "proctored" | "arena" | undefined;
    if (body.quizMode !== undefined) {
      try {
        parsedQuizMode = parseQuizMode(body.quizMode);
      } catch (err) {
        if (err instanceof InvalidQuizModeError) {
          return NextResponse.json(
            { error: "Invalid quiz mode.", code: "INVALID_QUIZ_MODE" },
            { status: 400 },
          );
        }
        throw err;
      }

      const existingMode = (existingQuiz.quizMode as QuizMode) || "proctored";
      if (parsedQuizMode !== existingMode) {
        const attemptsCount = await prisma.studentQuiz.count({
          where: { quizId },
        });
        const transition = canChangeQuizMode({
          currentMode: existingMode,
          targetMode: parsedQuizMode,
          attemptsCount,
          quizStatus: existingQuiz.quizStatus,
        });
        if (!transition.allowed) {
          return NextResponse.json(
            { error: transition.error, code: transition.code },
            { status: 409 },
          );
        }
      }
    }

    // Transactional update for quiz and optional questions
    const updateQuiz = async (tx: Prisma.TransactionClient) => {
      if (requestedStatus === "ended" && existingQuiz.quizMode !== "arena") {
        // Serialize End with entry/retake timing decisions for this session.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`quiz-lifecycle:${quizId}`}))`;
      }
      // Reject an obsolete edit instead of writing pre-End/reset metadata.
      if (existingQuiz.quizMode === "arena" || parsedQuizMode === "arena") {
        const currentQuiz = await tx.quiz.findUnique({ where: { id: quizId } });
        if (JSON.stringify(currentQuiz) !== JSON.stringify(existingQuiz)) {
          return { error: "Quiz changed while editing. Reload and retry.", code: "QUIZ_CHANGED", status: 409 };
        }
      }
      const studentQuizCount = await tx.studentQuiz.count({ where: { quizId } });
      if (parsedQuizMode && parsedQuizMode !== existingQuiz.quizMode) {
        const transition = canChangeQuizMode({ currentMode: existingQuiz.quizMode as QuizMode, targetMode: parsedQuizMode, attemptsCount: studentQuizCount, quizStatus: existingQuiz.quizStatus });
        if (!transition.allowed) return { error: transition.error, code: transition.code, status: 409 };
      }
      if (studentQuizCount > 0) {
        if (body.questions !== undefined || (body.totalQuestions !== undefined && body.totalQuestions !== existingQuiz.totalQuestions)) {
          return { error: "Questions cannot be changed after students have joined or attempted this quiz.", code: "QUIZ_CONTENT_LOCKED", status: 409 };
        }

      }

      const editedQuestions = body.questions === undefined ? null : validateEditedQuestions(body.questions);
      if (editedQuestions?.error) {
        return { error: editedQuestions.error, code: "INVALID_QUIZ_QUESTIONS", status: 400 };
      }

      let totalQCount = existingQuiz.totalQuestions;
      if (editedQuestions?.questions) {
        // Delete existing choices & questions
        await tx.choice.deleteMany({
          where: { question: { quizId } },
        });
        await tx.question.deleteMany({
          where: { quizId },
        });

        // Re-create new questions & choices
        for (const question of editedQuestions.questions) {
          await tx.question.create({
            data: { quizId, ...question },
          });
        }
        totalQCount = editedQuestions.questions.length;
      }

      let subjectId = existingQuiz.subjectId;
      if (subjectName !== undefined) {
        let subject = await tx.subject.findFirst({
          where: { teacherId: session.userId, subjectName: { equals: subjectName, mode: "insensitive" } },
        });
        if (!subject || subject.subjectName !== subjectName) {
          subject = await tx.subject.create({
            data: { teacherId: session.userId, subjectName, subjectCode: `SUB-${crypto.randomBytes(5).toString("hex").toUpperCase()}` },
          });
        }
        subjectId = subject.id;
      }

      if (requestedStatus === "ended" && existingQuiz.quizMode !== "arena") {
        const endedAt = new Date().toISOString();
        await tx.setting.upsert({ where: { settingKey: `proctored:quiz-ended:${quizId}` },
          create: { settingKey: `proctored:quiz-ended:${quizId}`, settingValue: endedAt },
          update: { settingValue: endedAt } });
      }
      const quiz = await tx.quiz.update({
        where: { id: quizId },
        data: {
          title: title ?? existingQuiz.title,
          description: description !== undefined ? description : existingQuiz.description,
          quizStatus: requestedStatus ?? existingQuiz.quizStatus,
          duration: requestedDuration ?? existingQuiz.duration,
          passingScore: passingScore ?? existingQuiz.passingScore,
          shuffleQuestions: shuffleQuestions ?? existingQuiz.shuffleQuestions,
          allowRetake: body.allowRetake ?? existingQuiz.allowRetake,
          isGamified: isGamified ?? existingQuiz.isGamified,
          quizMode: parsedQuizMode ?? existingQuiz.quizMode,
          subjectId,
          totalQuestions: totalQCount,
        },
        include: {
          subject: true,
          questions: {
            include: { choices: true },
          },
        },
      });
      return { quiz };
    };
    const update = existingQuiz.quizMode === "arena" || parsedQuizMode === "arena"
      ? await mutateArena(quizId, ({ tx }) => updateQuiz(tx))
      : await prisma.$transaction(updateQuiz);

    if (update.error) {
      return NextResponse.json({ error: update.error, code: update.code }, { status: update.status });
    }
    const updatedQuiz = update.quiz;

    // Broadcast quiz status update to all waiting students in lobby
    if (requestedStatus) {
      try {
        const { pusherServer } = await import("@/lib/pusher");
        await pusherServer.trigger(`private-quiz-${quizId}`, "quiz-started", {
          quizId,
          quizStatus: requestedStatus,
        });
      } catch (e) {
        console.error("Failed to broadcast quiz status update:", e);
      }
    }

    return NextResponse.json({ success: true, quiz: updatedQuiz });
  } catch (error) {
    console.error("Update quiz error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

async function DELETEImpl(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session || (session.role !== "teacher" && session.role !== "admin")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const quizId = parseInt(id);

    const existingQuiz = await prisma.quiz.findUnique({
      where: { id: quizId },
    });

    if (!existingQuiz) {
      return NextResponse.json({ error: "Quiz not found" }, { status: 404 });
    }
    if (!isQuizAvailable(existingQuiz.quizStatus)) {
      return NextResponse.json(quizNotAvailableResponse(), { status: 410 });
    }

    // Only the teacher who created the quiz or an admin can delete it
    if (session.role !== "admin" && existingQuiz.teacherId !== session.userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const deletedAt = new Date();
    const deleteQuiz = async (tx: Prisma.TransactionClient) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`quiz-lifecycle:${quizId}`}))`;
      const markedDeleted = await tx.quiz.updateMany({
        where: { id: quizId, quizStatus: { not: DELETED_QUIZ_STATUS } },
        data: { quizStatus: DELETED_QUIZ_STATUS, accessCode: null },
      });
      if (markedDeleted.count !== 1) return false;

      await tx.studentQuiz.updateMany({
        where: {
          quizId,
          quizStatus: { notIn: ["completed", "rejected"] },
        },
        data: { quizStatus: "rejected", endTime: deletedAt },
      });
      return true;
    };
    const deleted = existingQuiz.quizMode === "arena"
      ? await mutateArena(quizId, ({ tx }) => deleteQuiz(tx))
      : await prisma.$transaction(deleteQuiz);

    if (!deleted) {
      return NextResponse.json(quizNotAvailableResponse(), { status: 410 });
    }

    // Log activity
    await prisma.activityLog.create({
      data: {
        userId: session.userId,
        activity: `Deleted quiz: ${existingQuiz.title}`,
        ipAddress: req.headers.get("x-forwarded-for") || "unknown",
      },
    });

    // Broadcast quiz deletion to admin
    try {
      const { pusherServer } = await import("@/lib/pusher");
      await pusherServer.trigger("private-admin-dashboard", "activity", {
        type: "quiz-deleted",
        userId: session.userId,
        fullName: session.fullName,
        role: session.role,
        activity: `Deleted quiz: ${existingQuiz.title}`,
        timestamp: new Date().toISOString(),
      });
    } catch (e) {
      console.error("Failed to broadcast quiz deletion to admin:", e);
    }

    return NextResponse.json({ success: true, message: "Quiz deleted successfully" });
  } catch (error) {
    console.error("Delete quiz error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export const PUT = withBackupWriteGate(PUTImpl);

export const DELETE = withBackupWriteGate(DELETEImpl);
