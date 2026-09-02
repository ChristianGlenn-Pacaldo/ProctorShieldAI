import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import crypto from "node:crypto";
import { getTeacherEntitlements } from "@/lib/teacher-entitlements";
import { getQuizCreationDecision } from "@/lib/subscription-rules";

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
        where: { teacherId: session.userId },
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

      return NextResponse.json({
        success: true,
        quizzes,
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
      });
    } else if (session.role === "student") {
      // Students get the quizzes they have joined
      const studentQuizzes = await prisma.studentQuiz.findMany({
        where: { studentId: session.userId },
        include: {
          quiz: {
            include: { subject: true, teacher: true },
          },
          aiAnalysis: true,
        },
        orderBy: { createdAt: "desc" },
      });
      return NextResponse.json({ success: true, quizzes: studentQuizzes });
    } else if (session.role === "admin") {
      // Admins get all quizzes
      const quizzes = await prisma.quiz.findMany({
        include: {
          subject: true,
          teacher: true,
          _count: { select: { studentQuizzes: true } },
        },
        orderBy: { createdAt: "desc" },
      });
      return NextResponse.json({ success: true, quizzes });
    }

    return NextResponse.json({ error: "Invalid role" }, { status: 403 });
  } catch (error) {
    console.error("Fetch quizzes error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
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
      isGamified,
      isAiGenerated,
    } = await req.json();
    const isAiQuiz = isAiGenerated === true;

    if (typeof subjectName !== "string" || typeof title !== "string" || !subjectName.trim() || !title.trim()) {
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

            // Ensure at least one choice is marked correct
            if (validChoices.length > 0 && !validChoices.some((c) => c.isCorrect)) {
              validChoices[0].isCorrect = true;
            }

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
          duration: Math.max(1, Math.min(480, Number(duration) || 60)),
          totalQuestions: validQuestions.length > 0 ? validQuestions.length : (totalQuestions || 10),
          passingScore: Math.max(0, Math.min(100, Number(passingScore) || 50)),
          quizStatus: "draft",
          quizType: isGamified !== false ? "gamified" : "standard",
          shuffleQuestions: Boolean(shuffleQuestions),
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
        entitlements: await getTeacherEntitlements(session.userId, tx),
      };
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

    // Broadcast quiz creation to admin
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
    } catch (e) {
      console.error("Failed to broadcast quiz creation to admin:", e);
    }

    return NextResponse.json(
      { success: true, quiz, entitlements: creation.entitlements },
      { status: 201 },
    );
  } catch (error: unknown) {
    console.error("Create quiz error:", error);
    return NextResponse.json({ error: "Failed to create quiz" }, { status: 500 });
  }
}
