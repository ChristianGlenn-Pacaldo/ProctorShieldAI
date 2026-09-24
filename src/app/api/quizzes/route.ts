import { after, NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import crypto from "node:crypto";
import { getTeacherEntitlements } from "@/lib/teacher-entitlements";
import { getQuizCreationDecision } from "@/lib/subscription-rules";
import { parseQuizMode, InvalidQuizModeError } from "@/lib/quiz-mode";
import { UNAVAILABLE_QUIZ_STATUSES } from "@/lib/quiz-availability";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };

type RawChoice = { choiceText?: unknown; isCorrect?: unknown };
type RawQuestion = { questionText?: unknown; questionType?: unknown; points?: unknown; choices?: unknown };

function newCode(prefix: string) {
  return `${prefix}-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;
}

export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (session.role === "teacher") {
      // Teachers get the quizzes they created
      const quizzes = await prisma.quiz.findMany({
        where: {
          teacherId: session.userId,
          quizStatus: { notIn: [...UNAVAILABLE_QUIZ_STATUSES] },
        },
        include: {
          subject: true,
          _count: { select: { studentQuizzes: true } },
        },
        orderBy: { createdAt: "desc" },
      });

      // Fetch pending retakes for this teacher
      const pendingRetakes = await prisma.studentQuiz.findMany({
        where: {
          quizStatus: "pending_retake",
          quiz: { teacherId: session.userId },
        },
        include: {
          student: { select: { fullName: true } },
          quiz: { select: { title: true } },
        },
      });

      // Fetch pending late-join approvals for this teacher
      const pendingApprovals = await prisma.studentQuiz.findMany({
        where: {
          quizStatus: "pending_approval",
          quiz: { teacherId: session.userId },
        },
        include: {
          student: { select: { fullName: true } },
          quiz: { select: { title: true } },
        },
      });

      const entitlements = await getTeacherEntitlements(session.userId);
      const distinctParticipants = await prisma.studentQuiz.findMany({
        where: { quizId: { in: quizzes.map((quiz) => quiz.id) } },
        select: { quizId: true, studentId: true },
        distinct: ["quizId", "studentId"],
      });
      const participantCounts = distinctParticipants.reduce((counts, enrollment) => {
        counts.set(enrollment.quizId, (counts.get(enrollment.quizId) ?? 0) + 1);
        return counts;
      }, new Map<number, number>());

      return NextResponse.json({
        success: true,
        quizzes: quizzes.map((quiz) => ({
          ...quiz,
          participantCount: participantCounts.get(quiz.id) ?? 0,
          participantLimit: entitlements.studentLimitPerQuiz,
        })),
        entitlements,
        pendingRetakes: pendingRetakes.map((pr) => ({
          studentQuizId: pr.id,
          studentName: pr.student.fullName,
          quizTitle: pr.quiz.title,
          quizId: pr.quizId,
        })),
        pendingApprovals: pendingApprovals.map((pa) => ({
          studentQuizId: pa.id,
          studentName: pa.student.fullName,
          quizTitle: pa.quiz.title,
          quizId: pa.quizId,
        })),
      }, { headers: NO_STORE_HEADERS });
    } else if (session.role === "student") {
      // Students get the quizzes they have joined
      const studentQuizzes = await prisma.studentQuiz.findMany({
        where: {
          studentId: session.userId,
          quiz: { quizStatus: { notIn: [...UNAVAILABLE_QUIZ_STATUSES] } },
        },
        include: {
          quiz: {
            include: { subject: true, teacher: true },
          },
          aiAnalysis: true,
        },
        orderBy: { createdAt: "desc" },
      });
      return NextResponse.json({ success: true, quizzes: studentQuizzes }, { headers: NO_STORE_HEADERS });
    } else if (session.role === "admin") {
      // Admins get all quizzes
      const quizzes = await prisma.quiz.findMany({
        where: { quizStatus: { notIn: [...UNAVAILABLE_QUIZ_STATUSES] } },
        include: {
          subject: true,
          teacher: true,
          _count: { select: { studentQuizzes: true } },
        },
        orderBy: { createdAt: "desc" },
      });
      return NextResponse.json({ success: true, quizzes }, { headers: NO_STORE_HEADERS });
    }

    return NextResponse.json({ error: "Invalid role" }, { status: 403 });
  } catch (error) {
    console.error("Fetch quizzes error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID();
  try {
    const session = await getSession();
    if (!session || session.role !== "teacher") {
      const currentRole = session?.role ? ` (you are logged in as ${session.role})` : "";
      return NextResponse.json({ error: `Unauthorized. Only teachers can create quizzes${currentRole}.` }, { status: 401 });
    }

    const {
      subjectName,
      title,
      description,
      duration,
      totalQuestions,
      passingScore,
      questions,
      shuffleQuestions,
      allowRetake,
      isGamified,
      isAiGenerated,
      quizMode: rawQuizMode,
    } = await req.json();
    const isAiQuiz = isAiGenerated === true;

    let parsedQuizMode: "proctored" | "arena";
    try {
      parsedQuizMode = parseQuizMode(rawQuizMode);
    } catch (err) {
      if (err instanceof InvalidQuizModeError) {
        return NextResponse.json(
          { error: "Invalid quiz mode.", code: "INVALID_QUIZ_MODE" },
          { status: 400 },
        );
      }
      throw err;
    }

    if (
      typeof subjectName !== "string"
      || typeof title !== "string"
      || (description !== undefined && description !== null && typeof description !== "string")
      || !subjectName.trim()
      || !title.trim()
    ) {
      return NextResponse.json({ success: false, message: "Subject name and title are required" }, { status: 400 });
    }
    if (subjectName.length > 150 || title.length > 200 || (typeof description === "string" && description.length > 2_000)) {
      return NextResponse.json({ error: "Quiz metadata is too long" }, { status: 400 });
    }

    // Verify the teacher actually exists in the database (catches stale JWT after db reset)
    const teacherExists = await prisma.user.findUnique({ where: { id: session.userId } });
    if (!teacherExists) {
      return NextResponse.json({ 
        success: false, 
        message: "Your session is outdated. Please log out and log back in." 
      }, { status: 401 });
    }

    // Filter and sanitize questions and choices
    const validQuestions = Array.isArray(questions)
      ? (questions as RawQuestion[]).slice(0, 100)
          .filter((q) => q && typeof q.questionText === "string" && q.questionText.trim() !== "" && q.questionText.length <= 2_000)
          .map((q) => {
            const rawChoices = Array.isArray(q.choices) ? q.choices : [];
            const validChoices = rawChoices
              .slice(0, 10)
              .filter((c: RawChoice) => c && typeof c.choiceText === "string" && c.choiceText.trim() !== "" && c.choiceText.length <= 1_000)
              .map((c: RawChoice) => ({
                choiceText: String(c.choiceText).trim(),
                isCorrect: Boolean(c.isCorrect),
              }));

            return {
              questionText: String(q.questionText).trim(),
              questionType: typeof q.questionType === "string" ? q.questionType.slice(0, 50) : "multiple_choice",
              points: Math.max(1, Math.min(100, Number(q.points) || 1)),
              choices: {
                create: validChoices,
              },
            };
          })
      : [];

    if (validQuestions.length === 0 || !Array.isArray(questions) || validQuestions.length !== Math.min(questions.length, 100)) {
      return NextResponse.json({ error: "Add at least one complete question" }, { status: 400 });
    }
    if (validQuestions.some((question) => {
      if (question.questionType === "fill_in_blank") {
        return question.choices.create.length < 1 || !question.choices.create.some((choice) => choice.isCorrect);
      }
      return (
        question.choices.create.length < 2
        || question.choices.create.filter((choice) => choice.isCorrect).length !== 1
      );
    })) {
      return NextResponse.json(
        { error: "Every question must have complete answers and a correct answer marked" },
        { status: 400 },
      );
    }

    const creation = await prisma.$transaction(async (tx) => {
      // Serialize quiz creation per teacher so concurrent requests cannot exceed
      // the free quota. The project uses PostgreSQL, so this lock lasts only for
      // the current transaction.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`quiz-creation:${session.userId}`}))`;

      const entitlements = await getTeacherEntitlements(session.userId, tx);
      const decision = getQuizCreationDecision(entitlements, isAiQuiz);
      if (!decision.allowed) {
        return { quiz: null, entitlements, decision };
      }

      let subject = await tx.subject.findFirst({
        where: {
          teacherId: session.userId,
          subjectName: { equals: subjectName, mode: "insensitive" },
        },
      });

      if (!subject) {
        subject = await tx.subject.create({
          data: {
            teacherId: session.userId,
            subjectName: subjectName.trim(),
            subjectCode: newCode("SUB"),
          },
        });
      }

      let accessCode = newCode("PS");
      let codeExists = await tx.quiz.findUnique({ where: { accessCode } });
      while (codeExists) {
        accessCode = newCode("PS");
        codeExists = await tx.quiz.findUnique({ where: { accessCode } });
      }

      const quiz = await tx.quiz.create({
        data: {
          teacherId: session.userId,
          subjectId: subject.id,
          title: title.trim(),
          description: description ? description.trim() : null,
          accessCode,
          isAiGenerated: isAiQuiz,
          isGamified: isGamified !== false,
          duration: Math.max(1, Math.min(480, Number(duration) || 60)),
          totalQuestions: validQuestions.length > 0 ? validQuestions.length : (totalQuestions || 10),
          passingScore: Math.max(0, Math.min(100, Number(passingScore) || 50)),
          quizStatus: "draft",
          quizType: isGamified !== false ? "gamified" : "standard",
          quizMode: parsedQuizMode,
          shuffleQuestions: Boolean(shuffleQuestions),
          allowRetake: allowRetake === true,
          questions: validQuestions.length > 0 ? { create: validQuestions } : undefined,
        },
      });

      await tx.activityLog.create({
        data: {
          userId: session.userId,
          activity: `${isAiQuiz ? "Created AI quiz" : "Created manual quiz"}: ${title.trim()}`,
          ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown",
        },
      });

      return {
        quiz,
        decision,
        entitlements,
      };
    }, {
      // Neon can occasionally need more than Prisma's short interactive-
      // transaction defaults, especially when waking a pooled connection.
      maxWait: 10_000,
      timeout: 20_000,
    });

    if (!creation.quiz) {
      return NextResponse.json(
        {
          error: creation.decision.message,
          message: creation.decision.message,
          code: creation.decision.code,
          entitlements: creation.entitlements,
        },
        { status: 403 },
      );
    }

    const quiz = creation.quiz;

    // Refresh this outside the write transaction. Keeping reporting queries out
    // of the critical section reduces lock time and avoids rolling back a quiz
    // just because an entitlement summary query was slow.
    let updatedEntitlements = creation.entitlements;
    try {
      updatedEntitlements = await getTeacherEntitlements(session.userId);
    } catch (error) {
      console.error(`[quiz-create:${requestId}] Failed to refresh entitlements:`, error);
      if (!isAiQuiz) {
        const manualQuizCount = creation.entitlements.manualQuizCount + 1;
        updatedEntitlements = {
          ...creation.entitlements,
          manualQuizCount,
          manualQuizzesRemaining: creation.entitlements.manualQuizLimit === null
            ? null
            : Math.max(0, creation.entitlements.manualQuizLimit - manualQuizCount),
        };
      }
    }

    // The realtime notification is a non-critical side effect. Scheduling it
    // after the response prevents a slow Pusher connection from making quiz
    // creation look like it failed in the browser.
    after(async () => {
      try {
        const { pusherServer } = await import("@/lib/pusher");
        await pusherServer.trigger("private-admin-dashboard", "activity", {
          type: "quiz-created",
          userId: session.userId,
          fullName: session.fullName,
          role: "teacher",
          activity: `${isAiQuiz ? "Created AI quiz" : "Created manual quiz"}: ${title}`,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        console.error(`[quiz-create:${requestId}] Failed to broadcast admin activity:`, error);
      }
    });

    return NextResponse.json(
      { success: true, quiz, entitlements: updatedEntitlements },
      { status: 201 },
    );
  } catch (error: unknown) {
    console.error(`[quiz-create:${requestId}] Create quiz error:`, error);
    const errorCode = typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : "";

    if (errorCode === "P2002") {
      return NextResponse.json(
        { error: "A generated quiz code conflicted with an existing quiz. Please try again.", code: "QUIZ_CODE_CONFLICT", requestId },
        { status: 409 },
      );
    }
    if (errorCode === "P2024" || errorCode === "P2028") {
      return NextResponse.json(
        { error: "The database took too long to create the quiz. Please try again.", code: "QUIZ_CREATE_TIMEOUT", requestId },
        { status: 503 },
      );
    }

    return NextResponse.json(
      { error: `We couldn't create the quiz. Please try again. Reference: ${requestId.slice(0, 8)}`, code: "QUIZ_CREATE_FAILED", requestId },
      { status: 500 },
    );
  }
}
