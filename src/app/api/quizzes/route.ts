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
      return NextResponse.json({ success: true, quizzes });
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

    const { subjectName, title, description, duration, totalQuestions, passingScore, questions, shuffleQuestions } = await req.json();

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

    // Generate random 4-digit access code (e.g. PS-1234)
    const accessCode = `PS-${Math.floor(1000 + Math.random() * 9000)}`;

    const quiz = await prisma.quiz.create({
      data: {
        teacherId: session.userId,
        subjectId: subject.id,
        title,
        description,
        accessCode,
        duration: duration || 60,
        totalQuestions: totalQuestions || (questions ? questions.length : 10),
        passingScore: passingScore || 50,
        quizStatus: "draft",
        shuffleQuestions: shuffleQuestions || false,
        questions: questions && questions.length > 0 ? {
          create: questions.map((q: any) => ({
            questionText: q.questionText,
            questionType: q.questionType || "multiple_choice",
            points: q.points || 1,
            choices: {
              create: q.choices.map((c: any) => ({
                choiceText: c.choiceText,
                isCorrect: c.isCorrect || false
              }))
            }
          }))
        } : undefined
      },
    });

    // Log activity
    await prisma.activityLog.create({
      data: {
        userId: session.userId,
        activity: `Created quiz: ${title}`,
        ipAddress: req.headers.get("x-forwarded-for") || "unknown",
      },
    });

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
  } catch (error: unknown) {
    console.error("Create quiz error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
