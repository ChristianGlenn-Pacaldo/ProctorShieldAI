import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { consumeRateLimitGroup, getClientIp } from "@/lib/security";
import { normalizeQuizAccessCode, QUIZ_ACCESS_CODE_INPUT_MAX_LENGTH } from "@/lib/quiz-access-code";
import { hasActiveProSubscription } from "@/lib/teacher-entitlements";
import { getQuizCapacityDecision } from "@/lib/subscription-rules";
import { getStudentInitials } from "@/lib/student-identity";
import { parseQuizMode, type QuizMode } from "@/lib/quiz-mode";
import { getQuizJoinDestination, getQuizJoinEligibility } from "@/lib/quiz-join";

type JoinQuizRecord = Awaited<ReturnType<typeof findQuizByAccessCode>>;

async function findQuizByAccessCode(accessCode: string) {
  return prisma.quiz.findUnique({
    where: { accessCode },
    include: {
      subject: true,
      teacher: { select: { fullName: true } },
    },
  });
}

async function getExistingEnrollment(studentId: string, quizId: number) {
  return prisma.studentQuiz.findFirst({
    where: { studentId, quizId },
    orderBy: { attemptNumber: "desc" },
  });
}

async function getArenaSessionSummary(quizId: number, quizMode: QuizMode) {
  if (quizMode !== "arena") return null;
  const record = await prisma.setting.findUnique({
    where: { settingKey: `arena:state:${quizId}` },
    select: { settingValue: true },
  });
  if (!record?.settingValue) return { exists: false, status: null, sessionId: null };
  try {
    const state = JSON.parse(record.settingValue) as { status?: unknown; sessionId?: unknown };
    return {
      exists: true,
      status: typeof state.status === "string" ? state.status : null,
      sessionId: typeof state.sessionId === "string" ? state.sessionId : null,
    };
  } catch {
    return { exists: true, status: null, sessionId: null };
  }
}

async function buildJoinDetails(quiz: NonNullable<JoinQuizRecord>, quizMode: QuizMode, hasEnrollment: boolean) {
  return {
    quiz: {
      id: quiz.id,
      title: quiz.title,
      teacher: quiz.teacher.fullName,
      subject: quiz.subject.subjectName,
      quizMode,
      isArena: quizMode === "arena",
      quizStatus: quiz.quizStatus,
    },
    destination: getQuizJoinDestination(quiz.id, quizMode),
    join: getQuizJoinEligibility({ quizMode, quizStatus: quiz.quizStatus, hasEnrollment }),
    arenaSession: await getArenaSessionSummary(quiz.id, quizMode),
  };
}

export async function GET(req: NextRequest) {
  try {
    const session = await getSession("student");
    if (!session || session.role.toLowerCase() !== "student") {
      return NextResponse.json({ error: "Unauthorized. Only students can look up quiz codes." }, { status: 401 });
    }

    const accessCode = req.nextUrl.searchParams.get("accessCode") || "";
    if (!accessCode.trim()) {
      return NextResponse.json({ error: "Access code is required" }, { status: 400 });
    }
    if (accessCode.length > QUIZ_ACCESS_CODE_INPUT_MAX_LENGTH) {
      return NextResponse.json({ error: "Invalid access code. Quiz not found." }, { status: 404 });
    }

    const normalizedAccessCode = normalizeQuizAccessCode(accessCode);
    const rateLimit = await consumeRateLimitGroup(
      [`quiz-lookup:user:${session.userId}`, `quiz-lookup:ip:${getClientIp(req)}`],
      30,
      15 * 60_000,
    );
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "Too many access-code attempts" },
        { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
      );
    }

    const quiz = await findQuizByAccessCode(normalizedAccessCode);
    if (!quiz) {
      return NextResponse.json({ error: "Invalid access code. Quiz not found." }, { status: 404 });
    }

    const quizMode = parseQuizMode(quiz.quizMode);
    const enrollment = await getExistingEnrollment(session.userId, quiz.id);
    return NextResponse.json({
      success: true,
      ...(await buildJoinDetails(quiz, quizMode, Boolean(enrollment))),
    });
  } catch (error) {
    console.error("Lookup quiz code error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession("student");
    if (!session || !session.role || session.role.toLowerCase() !== "student") {
      const currentRole = session?.role ? ` (you are logged in as ${session.role})` : "";
      return NextResponse.json({ error: `Unauthorized. Only students can join quizzes${currentRole}.` }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const { accessCode } = body as { accessCode?: unknown };

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
    const quiz = await findQuizByAccessCode(normalizedAccessCode);

    if (!quiz) {
      return NextResponse.json({ error: "Invalid access code. Quiz not found." }, { status: 404 });
    }

    const quizMode = parseQuizMode(quiz.quizMode);
    const existingEnrollment = await getExistingEnrollment(session.userId, quiz.id);
    const initialJoinDetails = await buildJoinDetails(quiz, quizMode, Boolean(existingEnrollment));

    if (quiz.quizStatus === "ended") {
      if (initialJoinDetails.join.reviewOnly) {
        return NextResponse.json({
          success: true,
          message: initialJoinDetails.join.message,
          ...initialJoinDetails,
        });
      }
      return NextResponse.json({
        error: initialJoinDetails.join.message,
        ...initialJoinDetails,
      }, { status: 403 });
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
          attemptMode: quizMode,
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

    const studentInitials = getStudentInitials(session.fullName, "ST");

    if (enrollmentResult.kind === "existing") {
      // Trigger live arena join event so the teacher's lobby displays returning students immediately
      if (quizMode === "arena") {
        try {
          const { pusherServer } = await import("@/lib/pusher");
          const arenaPayload = {
            quizId: quiz.id,
            studentId: session.userId,
            studentName: session.fullName,
            initials: studentInitials,
            timestamp: new Date().toISOString(),
          };
          await Promise.allSettled([
            pusherServer.trigger(`private-arena-${quiz.id}`, "arena-student-joined", arenaPayload),
            pusherServer.trigger(`private-teacher-${quiz.teacherId}`, "arena-student-joined", arenaPayload),
          ]);
        } catch (e) {
          console.error("Failed to trigger push event for existing student:", e);
        }
      }

      return NextResponse.json({
        success: true,
        message: `Welcome back to ${quiz.title}`,
        ...(await buildJoinDetails(quiz, quizMode, true)),
      }, { status: 200 });
    }

    const { studentQuiz, isLateJoin, capacity } = enrollmentResult;

    // Create notification for Teacher (Proctored quizzes only)
    let teacherNotificationId = null;
    let teacherNotificationDate = new Date().toISOString();
    if (quizMode !== "arena") {
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
    }

    // Create notification for Student
    try {
      await prisma.notification.create({
        data: {
          userId: session.userId,
          title: quizMode === "arena" ? "Power Arena Joined" : "Quiz Joined",
          message: `You have successfully joined "${quiz.title}" (${quiz.subject.subjectName}).`,
        },
      });
    } catch (e) {
      console.error("Failed to create student notification:", e);
    }

    // Trigger Pusher notification events
    try {
      const { pusherServer } = await import("@/lib/pusher");
      
      if (quizMode !== "arena") {
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
      }

      if (quizMode === "arena") {
        // Broadcast arena student joined only on private-arena channel and teacher channel
        const arenaPayload = {
          quizId: quiz.id,
          studentId: session.userId,
          studentName: session.fullName,
          initials: studentInitials,
          timestamp: new Date().toISOString(),
        };
        await Promise.allSettled([
          pusherServer.trigger(`private-arena-${quiz.id}`, "arena-student-joined", arenaPayload),
          pusherServer.trigger(`private-teacher-${quiz.teacherId}`, "arena-student-joined", arenaPayload),
        ]);
      }
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
      ...(await buildJoinDetails(quiz, quizMode, true)),
      capacity,
    }, { status: 201 });

  } catch (error) {
    console.error("Join quiz error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
