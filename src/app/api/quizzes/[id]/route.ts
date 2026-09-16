import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { canStudentEnterQuiz } from "@/lib/quiz-access";
import { deleteEvidence } from "@/lib/evidence-storage";
import { parseQuizMode, InvalidQuizModeError, canChangeQuizMode, type QuizMode } from "@/lib/quiz-mode";

// Seeded random number generator (Mulberry32 variant)
function seededRandom(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0;
  }
  return function() {
    let t = h += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Seeded array shuffling helper
function shuffleArray<T>(array: T[], seed: string): T[] {
  const rand = seededRandom(seed);
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

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
          include: {
            choices: true
          }
        }
      }
    });

    if (!quiz) {
      return NextResponse.json({ error: "Quiz not found" }, { status: 404 });
    }

    if (session.role === "teacher" && quiz.teacherId !== session.userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    let questions = quiz.questions;
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

      if (quiz.quizStatus === "ended" && studentQuiz.quizStatus !== "in_progress") {
        return NextResponse.json({ error: "This quiz has already ended." }, { status: 403 });
      }

      const canEnterQuiz = canStudentEnterQuiz({
        quizStatus: quiz.quizStatus,
        studentQuizStatus: studentQuiz.quizStatus,
        startTime: studentQuiz.startTime,
        endTime: studentQuiz.endTime,
      });

      if (canEnterQuiz && quiz.shuffleQuestions) {
        // Shuffle questions deterministically using the student's unique studentQuiz.id
        questions = shuffleArray(quiz.questions, studentQuiz.id);
        
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
    const safeQuestions = session.role === "student" && !canEnterQuiz ? [] : questions;
    const savedAnswers = session.role === "student" && studentQuiz && canEnterQuiz
      ? await prisma.answer.findMany({
          where: { studentQuizId: studentQuiz.id },
          select: { questionId: true, answerText: true, isCorrect: true },
        })
      : [];
    const violationCount = session.role === "student" && studentQuiz
      ? await prisma.violation.count({ where: { studentQuizId: studentQuiz.id } })
      : undefined;
    const remainingSeconds = session.role === "student" && studentQuiz?.startTime
      ? Math.max(
          0,
          Math.ceil(
            (studentQuiz.startTime.getTime() + (quiz.duration ?? 60) * 60_000 - Date.now()) / 1000,
          ),
        )
      : undefined;

    return NextResponse.json({
      success: true,
      userId: session.userId,
      studentQuizStatus: session.role === "student" ? studentQuiz?.quizStatus : undefined,
      studentQuizId: session.role === "student" ? studentQuiz?.id : undefined,
      attemptMode: session.role === "student" ? studentQuiz?.attemptMode || "proctored" : undefined,
      canEnterQuiz: session.role === "student" ? canEnterQuiz : undefined,
      remainingSeconds,
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
    });

  } catch (error) {
    console.error("Get quiz details error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}


export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
      if (!Number.isInteger(requestedDuration) || requestedDuration < 1 || requestedDuration > 480) {
        return NextResponse.json({ error: "Duration must be between 1 and 480 minutes" }, { status: 400 });
      }
      if (["in_progress", "ended"].includes(existingQuiz.quizStatus)) {
        return NextResponse.json({ error: "Duration cannot be changed after a quiz starts" }, { status: 409 });
      }
    }
    if (body.allowRetake !== undefined && typeof body.allowRetake !== "boolean") {
      return NextResponse.json({ error: "allowRetake must be a boolean" }, { status: 400 });
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
    const updatedQuiz = await prisma.$transaction(async (tx) => {
      // If questions array is passed and quiz is in draft or has no student submissions
      if (Array.isArray(body.questions) && body.questions.length > 0) {
        const studentQuizCount = await tx.studentQuiz.count({ where: { quizId } });
        if (studentQuizCount === 0) {
          // Delete existing choices & questions
          await tx.choice.deleteMany({
            where: { question: { quizId } },
          });
          await tx.question.deleteMany({
            where: { quizId },
          });

          // Re-create new questions & choices
          for (const q of body.questions) {
            if (q && typeof q.questionText === "string" && q.questionText.trim()) {
              await tx.question.create({
                data: {
                  quizId,
                  questionText: q.questionText.trim(),
                  points: typeof q.points === "number" ? q.points : 1,
                  questionType: q.questionType || "multiple_choice",
                  choices: {
                    create: (Array.isArray(q.choices) ? q.choices : []).map((c: any) => ({
                      choiceText: String(c.choiceText || "").trim(),
                      isCorrect: Boolean(c.isCorrect),
                    })),
                  },
                },
              });
            }
          }
        }
      }

      const totalQCount = Array.isArray(body.questions) ? body.questions.length : undefined;

      return tx.quiz.update({
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
          totalQuestions: totalQCount ?? existingQuiz.totalQuestions,
        },
        include: {
          subject: true,
          questions: {
            include: { choices: true },
          },
        },
      });
    });

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

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

    // Only the teacher who created the quiz or an admin can delete it
    if (session.role !== "admin" && existingQuiz.teacherId !== session.userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const storedEvidence = await prisma.evidenceFile.findMany({
      where: { violation: { studentQuiz: { quizId } } },
      select: { filePath: true },
    });
    // Delete private objects first. If the later database transaction fails,
    // retrying this endpoint is safe because S3 deletion is idempotent.
    await deleteEvidence(storedEvidence.map((file) => file.filePath));

    // Perform cascade delete in a transaction
    await prisma.$transaction(async (tx) => {
      // 1. Get questions
      const questions = await tx.question.findMany({
        where: { quizId },
        select: { id: true }
      });
      const questionIds = questions.map(q => q.id);

      // 2. Get student quizzes
      const studentQuizzes = await tx.studentQuiz.findMany({
        where: { quizId },
        select: { id: true }
      });
      const studentQuizIds = studentQuizzes.map(se => se.id);

      if (studentQuizIds.length > 0) {
        // Get violations to delete evidence files first
        const violations = await tx.violation.findMany({
          where: { studentQuizId: { in: studentQuizIds } },
          select: { id: true }
        });
        const violationIds = violations.map(v => v.id);

        if (violationIds.length > 0) {
          await tx.evidenceFile.deleteMany({
            where: { violationId: { in: violationIds } }
          });
        }

        await tx.violation.deleteMany({
          where: { studentQuizId: { in: studentQuizIds } }
        });

        await tx.aiAnalysis.deleteMany({
          where: { studentQuizId: { in: studentQuizIds } }
        });

        await tx.answer.deleteMany({
          where: { studentQuizId: { in: studentQuizIds } }
        });

        await tx.studentQuiz.deleteMany({
          where: { id: { in: studentQuizIds } }
        });
      }

      if (questionIds.length > 0) {
        await tx.choice.deleteMany({
          where: { questionId: { in: questionIds } }
        });

        await tx.question.deleteMany({
          where: { quizId }
        });
      }

      // Finally, delete the quiz itself
      await tx.quiz.delete({
        where: { id: quizId }
      });
    });

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
