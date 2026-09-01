import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { consumeRateLimitGroup, getClientIp } from "@/lib/security";

export async function POST(req: NextRequest) {
  try {
    const session = await getSession("student");
    if (!session || !session.role || session.role.toLowerCase() !== "student") {
      const currentRole = session?.role ? ` (you are logged in as ${session.role})` : "";
      return NextResponse.json({ error: `Unauthorized. Only students can join quizzes${currentRole}.` }, { status: 401 });
    }

    const { accessCode } = await req.json();

    if (!accessCode) {
      return NextResponse.json({ error: "Access code is required" }, { status: 400 });
    }
    const rateLimit = await consumeRateLimitGroup(
      [`quiz-join:user:${session.userId}`, `quiz-join:ip:${getClientIp(req)}`],
      15,
      15 * 60_000,
    );
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "Too many access-code attempts" },
        { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
      );
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
      return NextResponse.json({ error: "Invalid access code. Quiz not found." }, { status: 404 });
    }
    
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
      return NextResponse.json({
        success: true,
        message: `Welcome back to ${quiz.title}`,
        quiz: {
          id: quiz.id,
          title: quiz.title,
          subject: quiz.subject.subjectName,
        },
      }, { status: 200 });
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

    // Create notification for Teacher
    let teacherNotificationId = null;
    let teacherNotificationDate = new Date().toISOString();
    try {
      const notification = await prisma.notification.create({
        data: {
          userId: quiz.teacherId,
          title: isLateJoin ? "Late Join Request" : "Student Joined Quiz",
          message: isLateJoin
            ? `${session.fullName} requested late entry for "${quiz.title}".`
            : `${session.fullName} joined your quiz: "${quiz.title}".`,
        },
      });
      teacherNotificationId = notification.id.toString();
      teacherNotificationDate = notification.createdAt.toISOString();
    } catch (e) {
      console.error("Failed to create teacher notification:", e);
    }

    // Create notification for Student
    try {
      await prisma.notification.create({
        data: {
          userId: session.userId,
          title: "Quiz Joined",
          message: `You have successfully joined "${quiz.title}" (${quiz.subject.subjectName}).`,
        },
      });
    } catch (e) {
      console.error("Failed to create student notification:", e);
    }

    // Trigger Pusher notification events
    try {
      const { pusherServer } = await import("@/lib/pusher");
      
      if (isLateJoin) {
        await pusherServer.trigger(`private-teacher-${quiz.teacherId}`, "late-join-request", {
          studentQuizId: studentQuiz.id,
          studentName: session.fullName,
          quizTitle: quiz.title,
          quizId: quiz.id,
        });
      }

      await pusherServer.trigger(`private-user-${quiz.teacherId}`, "notification", {
        id: teacherNotificationId,
        title: isLateJoin ? "Late Join Request" : "Student Joined Quiz",
        message: isLateJoin
            ? `${session.fullName} requested late entry for "${quiz.title}".`
            : `${session.fullName} joined "${quiz.title}".`,
        createdAt: teacherNotificationDate,
      });
    } catch (e) {
      console.error("Failed to trigger push event:", e);
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
