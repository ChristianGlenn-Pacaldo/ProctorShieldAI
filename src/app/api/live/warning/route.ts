import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { hasActiveProSubscription } from "@/lib/teacher-entitlements";
import { pusherServer } from "@/lib/pusher";
import { consumeRateLimit } from "@/lib/security";
import {
  getLatestLiveWarning,
  normalizeTeacherWarningMessage,
  saveLiveWarning,
  type LiveWarningRecord,
} from "@/lib/live-warning-store";

export async function POST(req: NextRequest) {
  try {
    const session = await getSession("teacher");
    if (!session || session.role !== "teacher") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!await hasActiveProSubscription(session.userId)) {
      return NextResponse.json(
        { error: "Live monitoring requires an active Pro subscription", code: "SUBSCRIPTION_REQUIRED" },
        { status: 403 },
      );
    }

    const body: unknown = await req.json().catch(() => null);
    const input = body && typeof body === "object" ? body as Record<string, unknown> : {};
    const studentId = typeof input.studentId === "string" ? input.studentId.trim() : "";
    if (!studentId || studentId.length > 100) {
      return NextResponse.json({ error: "Invalid student" }, { status: 400 });
    }

    const rateLimit = await consumeRateLimit(`teacher-warning:${session.userId}:${studentId}`, 6, 60_000);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "Too many warnings. Please wait before sending another.", retryAfterSeconds: rateLimit.retryAfterSeconds },
        { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
      );
    }

    const enrollment = await prisma.studentQuiz.findFirst({
      where: {
        studentId,
        quizStatus: "in_progress",
        startTime: { not: null },
        endTime: null,
        quiz: { teacherId: session.userId, quizStatus: "in_progress" },
      },
      include: { quiz: { select: { id: true, title: true } } },
      orderBy: { startTime: "desc" },
    });
    if (!enrollment) {
      return NextResponse.json({ error: "The student does not have an active quiz session." }, { status: 404 });
    }

    const message = normalizeTeacherWarningMessage(input.message);
    const notification = await prisma.notification.create({
      data: {
        userId: studentId,
        title: "Teacher Warning",
        message: `${session.fullName}: ${message}`,
      },
    });
    const warning: LiveWarningRecord = {
      id: notification.id.toString(),
      studentId,
      teacherId: session.userId,
      quizId: enrollment.quiz.id,
      message,
      createdAt: notification.createdAt.toISOString(),
    };
    await saveLiveWarning(warning);

    const events = await Promise.allSettled([
      pusherServer.trigger(`private-student-${studentId}`, "teacher-warning", warning),
      pusherServer.trigger(`private-user-${studentId}`, "notification", {
        id: warning.id,
        title: "Teacher Warning",
        message,
        isRead: false,
        createdAt: warning.createdAt,
      }),
    ]);

    return NextResponse.json({
      success: true,
      warning,
      realtimeDelivered: events[0].status === "fulfilled",
    });
  } catch (error: unknown) {
    console.error("Teacher warning POST error:", error);
    return NextResponse.json({ error: "Unable to send the warning" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const session = await getSession("student");
    if (!session || session.role !== "student") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const quizId = Number(req.nextUrl.searchParams.get("quizId"));
    if (!Number.isInteger(quizId) || quizId <= 0) {
      return NextResponse.json({ error: "Invalid quiz" }, { status: 400 });
    }

    const warning = await getLatestLiveWarning(session.userId, quizId);
    return NextResponse.json({ success: true, warning });
  } catch (error: unknown) {
    console.error("Teacher warning GET error:", error);
    return NextResponse.json({ error: "Unable to check for warnings" }, { status: 500 });
  }
}
