import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    console.log("DEBUG: QUIZS JOIN SESSION:", session);
    if (!session || !session.role || session.role.toLowerCase() !== "student") {
      const currentRole = session?.role ? ` (you are logged in as ${session.role})` : "";
      return NextResponse.json({ error: `Unauthorized. Only students can join quizzes${currentRole}.` }, { status: 401 });
    }

    const { accessCode } = await req.json();
    console.log("DEBUG JOIN ATTEMPT:", { session, accessCode });

    if (!accessCode) {
      return NextResponse.json({ error: "Access code is required" }, { status: 400 });
    }

    // Verify the student actually exists in the database (catches stale JWT after db reset)
    const studentExists = await prisma.user.findUnique({ where: { id: session.userId } });
    if (!studentExists) {
      return NextResponse.json({ 
        error: "Your session is outdated. Please log out and log back in." 
      }, { status: 401 });
    }

    // Find the quiz by access code
    const quiz = await prisma.quiz.findUnique({
      where: { accessCode: accessCode.trim().toUpperCase() },
      include: { subject: true },
    });

    if (!quiz) {
      console.log("DEBUG JOIN: Quiz not found for code:", accessCode.trim().toUpperCase());
      return NextResponse.json({ error: "Invalid access code. Quiz not found." }, { status: 404 });
    }
    
    console.log("DEBUG JOIN: Quiz found:", quiz.title);

    // We allow joining draft quizzes so they act as a "waiting room"
    // until the teacher formally starts the quiz.


    if (quiz.quizStatus === "ended") {
      return NextResponse.json({ error: "This quiz has already ended and is no longer accepting submissions." }, { status: 403 });
    }

    // Check if the student has already joined this quiz
    const existingEnrollment = await prisma.studentQuiz.findFirst({
      where: {
        studentId: session.userId,
        quizId: quiz.id,
      },
    });

    if (existingEnrollment) {
      return NextResponse.json({ error: "You have already joined this quiz." }, { status: 409 });
    }

    // Determine initial status based on quiz status
    const isLateJoin = quiz.quizStatus === "in_progress";
    const initialStudentQuizStatus = isLateJoin ? "pending_approval" : "enrolled";

    // Enroll student
    const studentQuiz = await prisma.studentQuiz.create({
      data: {
        studentId: session.userId,
        quizId: quiz.id,
        quizStatus: initialStudentQuizStatus,
      },
    });

    // Create a notification for the teacher
    let notificationId = null;
    const notification = await prisma.notification.create({
      data: {
        userId: quiz.teacherId,
        title: "Student Joined",
        message: `${session.fullName} has joined ${quiz.title}`,
        isRead: false,
      },
    });
    notificationId = notification.id;

    // Notify teacher via Pusher
    try {
      const { pusherServer } = await import("@/lib/pusher");
      
      // Personal notification for the teacher
      await pusherServer.trigger(`user-${quiz.teacherId}`, "notification", {
        id: notificationId,
        title: "Student Joined",
        message: `${session.fullName} has joined ${quiz.title}`,
        createdAt: new Date().toISOString(),
      });

      // Special event for late joins
      if (isLateJoin) {
        await pusherServer.trigger(`teacher-${quiz.teacherId}`, "late-join-request", {
          studentQuizId: studentQuiz.id,
          studentName: session.fullName,
          quizTitle: quiz.title,
          quizId: quiz.id,
        });
      }
    } catch (e) {
      console.error("Failed to trigger push events:", e);
    }

    // Log activity
    await prisma.activityLog.create({
      data: {
        userId: session.userId,
        activity: `Joined quiz: ${quiz.title} (${accessCode})`,
        ipAddress: req.headers.get("x-forwarded-for") || "unknown",
      },
    });

    return NextResponse.json({
      success: true,
      message: `Successfully joined ${quiz.title}`,
      quiz: {
        id: quiz.id,
        title: quiz.title,
        subject: quiz.subject.subjectName,
      },
    }, { status: 201 });

  } catch (error) {
    console.error("Join quiz error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
