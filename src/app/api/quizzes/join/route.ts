import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { consumeRateLimitGroup, getClientIp } from "@/lib/security";
import { normalizeQuizAccessCode, QUIZ_ACCESS_CODE_INPUT_MAX_LENGTH } from "@/lib/quiz-access-code";
import { hasActiveProSubscription } from "@/lib/teacher-entitlements";
import { getQuizCapacityDecision } from "@/lib/subscription-rules";
import { getArenaState } from "@/lib/arena";
import { AVATAR_CATALOG } from "@/lib/student-coins";

export async function POST(req: NextRequest) {
  try {
    const session = await getSession("student");
    if (!session || !session.role || session.role.toLowerCase() !== "student") {
      const currentRole = session?.role ? ` (you are logged in as ${session.role})` : "";
      return NextResponse.json({ error: `Unauthorized. Only students can join quizzes${currentRole}.` }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const { accessCode, avatar } = body as { accessCode?: unknown; avatar?: unknown };

    if (typeof accessCode !== "string" || !accessCode.trim()) {
      return NextResponse.json({ error: "Access code is required" }, { status: 400 });
    }
    if (accessCode.length > QUIZ_ACCESS_CODE_INPUT_MAX_LENGTH) {
      return NextResponse.json({ error: "Invalid access code. Quiz not found." }, { status: 404 });
    }
    const normalizedAccessCode = normalizeQuizAccessCode(accessCode);
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
      where: { accessCode: normalizedAccessCode },
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

    const enrollmentResult = await prisma.$transaction(async (tx) => {
      // Serialize enrollment for this quiz so simultaneous join requests cannot
      // exceed the plan capacity.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`quiz-enrollment:${quiz.id}`}))`;

      const currentQuiz = await tx.quiz.findUnique({
        where: { id: quiz.id },
        select: { quizStatus: true },
      });
      if (!currentQuiz || currentQuiz.quizStatus === "ended") {
        return { kind: "closed" as const };
      }

      // Returning students and approved retakes do not consume another seat.
      const existingEnrollment = await tx.studentQuiz.findFirst({
        where: {
          studentId: session.userId,
          quizId: quiz.id,
        },
        orderBy: { attemptNumber: "desc" },
      });
      if (existingEnrollment) {
        return { kind: "existing" as const };
      }

      const isSubscribed = await hasActiveProSubscription(quiz.teacherId, tx);
      const enrolledStudents = await tx.studentQuiz.findMany({
        where: { quizId: quiz.id },
        select: { studentId: true },
        distinct: ["studentId"],
      });
      const capacity = getQuizCapacityDecision(isSubscribed, enrolledStudents.length);
      if (!capacity.allowed) {
        return { kind: "full" as const, capacity };
      }

      const isLateJoin = currentQuiz.quizStatus === "in_progress";
      const studentQuiz = await tx.studentQuiz.create({
        data: {
          studentId: session.userId,
          quizId: quiz.id,
          quizStatus: isLateJoin ? "pending_approval" : "enrolled",
        },
      });

      return {
        kind: "created" as const,
        studentQuiz,
        isLateJoin,
        capacity: {
          limit: capacity.limit,
          enrolled: enrolledStudents.length + 1,
          remaining: Math.max(0, capacity.remaining - 1),
        },
      };
    });

    if (enrollmentResult.kind === "closed") {
      return NextResponse.json({ error: "This quiz has already ended and is no longer accepting submissions." }, { status: 403 });
    }

    if (enrollmentResult.kind === "full") {
      return NextResponse.json(
        {
          error: enrollmentResult.capacity.message,
          code: enrollmentResult.capacity.code,
          capacity: {
            limit: enrollmentResult.capacity.limit,
            enrolled: enrollmentResult.capacity.limit,
            remaining: 0,
          },
        },
        { status: 409 },
      );
    }

    // Resolve student avatar (passed from client, or from gameProfile, or default "🎓")
    let studentAvatar = typeof avatar === "string" && avatar.trim() ? avatar.trim() : "";
    if (!studentAvatar) {
      try {
        const studentProfile = await prisma.studentGameProfile.findUnique({
          where: { studentId: session.userId },
          select: { equippedAvatar: true },
        });
        const catalogItem = studentProfile?.equippedAvatar
          ? AVATAR_CATALOG.find((a) => a.id === studentProfile.equippedAvatar)
          : null;
        studentAvatar = catalogItem?.emoji || "🎓";
      } catch {
        studentAvatar = "🎓";
      }
    }

    if (enrollmentResult.kind === "existing") {
      // Trigger live arena join event so the teacher's lobby displays returning students immediately
      try {
        const { pusherServer } = await import("@/lib/pusher");
        const arenaPayload = {
          quizId: quiz.id,
          studentId: session.userId,
          studentName: session.fullName,
          avatar: studentAvatar,
          timestamp: new Date().toISOString(),
        };
        await Promise.allSettled([
          pusherServer.trigger(`private-teacher-${quiz.teacherId}`, "arena-student-joined", arenaPayload),
          pusherServer.trigger(`private-quiz-${quiz.id}`, "arena-student-joined", arenaPayload),
        ]);
      } catch (e) {
        console.error("Failed to trigger push event for existing student:", e);
      }

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

    const { studentQuiz, isLateJoin, capacity } = enrollmentResult;

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

      // Broadcast arena student joined to both teacher and quiz channels so the lobby displays them live
      const arenaPayload = {
        quizId: quiz.id,
        studentId: session.userId,
        studentName: session.fullName,
        avatar: studentAvatar,
        timestamp: new Date().toISOString(),
      };
      await Promise.allSettled([
        pusherServer.trigger(`private-teacher-${quiz.teacherId}`, "arena-student-joined", arenaPayload),
        pusherServer.trigger(`private-quiz-${quiz.id}`, "arena-student-joined", arenaPayload),
      ]);
    } catch (e) {
      console.error("Failed to trigger push event:", e);
    }

    // Log activity
    await prisma.activityLog.create({
      data: {
        userId: session.userId,
        activity: `Joined quiz: ${quiz.title} (${normalizedAccessCode})`,
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
      capacity,
    }, { status: 201 });

  } catch (error) {
    console.error("Join quiz error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
