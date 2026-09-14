import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getArenaState, isArenaPowerId } from "@/lib/arena";
import prisma from "@/lib/prisma";
import { pusherServer } from "@/lib/pusher";
import { consumeRateLimit } from "@/lib/security";
import { hasActiveProSubscription } from "@/lib/teacher-entitlements";

// POST /api/live/battle-action — broadcast one earned power per answered wave.
export async function POST(req: NextRequest) {
  try {
    const session = await getSession("student");
    if (!session || session.role !== "student") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body: unknown = await req.json().catch(() => null);
    const record = body && typeof body === "object" ? body as Record<string, unknown> : null;
    const quizId = Number(record?.quizId);
    const questionId = Number(record?.questionId);
    const powerType = record?.powerType;
    if (!Number.isSafeInteger(quizId) || quizId <= 0 || !Number.isSafeInteger(questionId) || questionId <= 0) {
      return NextResponse.json({ error: "Valid quizId and questionId are required" }, { status: 400 });
    }
    if (!isArenaPowerId(powerType)) {
      return NextResponse.json({ error: "Invalid battle power" }, { status: 400 });
    }

    const arena = await getArenaState(quizId);
    if (!arena || arena.status !== "active") {
      return NextResponse.json({ error: "The battle arena is not active" }, { status: 409 });
    }
    if (!arena.enabledPowers.includes(powerType)) {
      return NextResponse.json({ error: "That power is disabled for this arena" }, { status: 403 });
    }
    if (!(await hasActiveProSubscription(arena.teacherId))) {
      return NextResponse.json({ error: "The arena host no longer has an active Pro plan" }, { status: 403 });
    }

    const attempt = await prisma.studentQuiz.findFirst({
      where: {
        studentId: session.userId,
        quizId,
        endTime: null,
        quizStatus: "in_progress",
        quiz: { teacherId: arena.teacherId, quizStatus: "in_progress" },
        answers: { some: { questionId, isCorrect: { not: null } } },
      },
      select: { id: true },
      orderBy: { attemptNumber: "desc" },
    });
    if (!attempt) {
      return NextResponse.json(
        { error: "Answer this arena question before using a battle power" },
        { status: 403 },
      );
    }

    const rateLimit = await consumeRateLimit(
      `arena-power:${arena.sessionId}:${attempt.id}:${questionId}`,
      1,
      6 * 60 * 60_000,
    );
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "You already used a battle power for this question" },
        { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
      );
    }

    const eventData = {
      attackerId: session.userId,
      attackerName: session.fullName || "A rival student",
      targetId: powerType === "shield" ? session.userId : "all",
      targetName: powerType === "shield" ? (session.fullName || "A rival student") : "Rival Students",
      powerType,
      questionId,
      sessionId: arena.sessionId,
      timestamp: new Date().toISOString(),
    };
    try {
      await pusherServer.trigger(`private-quiz-${quizId}`, "battle-attack", eventData);
    } catch (error) {
      console.error("Battle action realtime broadcast failed:", error);
      return NextResponse.json({ error: "Battle action could not be delivered" }, { status: 503 });
    }

    return NextResponse.json({ success: true, ...eventData });
  } catch (error) {
    console.error("Battle action API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
