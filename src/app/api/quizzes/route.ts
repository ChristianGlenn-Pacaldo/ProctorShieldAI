import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";

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

      return NextResponse.json({
        success: true,
        quizzes,
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

    const { subjectName, title, description, duration, totalQuestions, passingScore, questions, shuffleQuestions, isGamified } = await req.json();

    if (!subjectName || !title) {
      return NextResponse.json({ success: false, message: "Subject name and title are required" }, { status: 400 });
    }

    // Verify the teacher actually exists in the database (catches stale JWT after db reset)
    const teacherExists = await prisma.user.findUnique({ where: { id: session.userId } });
    if (!teacherExists) {
      return NextResponse.json({ 
        success: false, 
        message: "Your session is outdated. Please log out and log back in." 
      }, { status: 401 });
    }

    // Find or create subject
    let subject = await prisma.subject.findFirst({
      where: { 
        teacherId: session.userId,
        subjectName: { equals: subjectName, mode: "insensitive" }
      }
    });

    if (!subject) {
      subject = await prisma.subject.create({
        data: {
          teacherId: session.userId,
          subjectName: subjectName,
          subjectCode: `SUB-${Math.floor(1000 + Math.random() * 9000)}`
        }
      });
    }

    // Generate unique 4-digit access code (e.g. PS-1234)
    let accessCode = `PS-${Math.floor(1000 + Math.random() * 9000)}`;
    let codeExists = await prisma.quiz.findUnique({ where: { accessCode } });
    while (codeExists) {
      accessCode = `PS-${Math.floor(1000 + Math.random() * 9000)}`;
      codeExists = await prisma.quiz.findUnique({ where: { accessCode } });
    }

    // Filter and sanitize questions and choices
    const validQuestions = Array.isArray(questions)
      ? questions
          .filter((q: any) => q && q.questionText && String(q.questionText).trim() !== "")
          .map((q: any) => {
            const rawChoices = Array.isArray(q.choices) ? q.choices : [];
            const validChoices = rawChoices
              .filter((c: any) => c && c.choiceText && String(c.choiceText).trim() !== "")
              .map((c: any) => ({
                choiceText: String(c.choiceText).trim(),
                isCorrect: Boolean(c.isCorrect),
              }));

            // Ensure at least one choice is marked correct
            if (validChoices.length > 0 && !validChoices.some((c: any) => c.isCorrect)) {
              validChoices[0].isCorrect = true;
            }

            return {
              questionText: String(q.questionText).trim(),
              questionType: q.questionType || "multiple_choice",
              points: Number(q.points) || 1,
              choices: {
                create: validChoices,
              },
            };
          })
      : [];

    const quiz = await prisma.quiz.create({
      data: {
        teacherId: session.userId,
        subjectId: subject.id,
        title: title.trim(),
        description: description ? description.trim() : null,
        accessCode,
        duration: duration || 60,
        totalQuestions: validQuestions.length > 0 ? validQuestions.length : (totalQuestions || 10),
        passingScore: passingScore || 50,
        quizStatus: "draft",
        quizType: isGamified !== false ? "gamified" : "standard",
        shuffleQuestions: shuffleQuestions || false,
        questions: validQuestions.length > 0 ? {
          create: validQuestions,
        } : undefined
      },
    });

    // Log activity
    try {
      await prisma.activityLog.create({
        data: {
          userId: session.userId,
          activity: `Created quiz: ${title}`,
          ipAddress: req.headers.get("x-forwarded-for") || "unknown",
        },
      });
    } catch {}

    // Broadcast quiz creation to admin
    try {
      const { pusherServer } = await import("@/lib/pusher");
      await pusherServer.trigger("admin-dashboard", "activity", {
        type: "quiz-created",
        userId: session.userId,
        fullName: session.fullName,
        role: "teacher",
        activity: `Created quiz: ${title}`,
        timestamp: new Date().toISOString(),
      });
    } catch (e) {
      console.error("Failed to broadcast quiz creation to admin:", e);
    }

    return NextResponse.json({ success: true, quiz }, { status: 201 });
  } catch (error: any) {
    console.error("Create quiz error:", error);
    return NextResponse.json({ error: error?.message || "Failed to create quiz" }, { status: 500 });
  }
}
