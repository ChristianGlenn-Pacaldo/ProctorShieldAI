import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getArenaState, isArenaPowerId } from "@/lib/arena";
import prisma from "@/lib/prisma";
import { pusherServer } from "@/lib/pusher";
import { consumeRateLimit } from "@/lib/security";

// POST /api/arena/battle-action — broadcast arena power usage against rivals in Power Arena
export async function POST(req: NextRequest) {
  try {
    const session = await getSession("student");
    if (!session || session.role !== "student") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body: unknown = await req.json().catch(() => null);
    const record = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
    const quizId = Number(record?.quizId);
    const questionId = Number(record?.questionId) || 0;
    const powerType = record?.powerType;

    if (!Number.isSafeInteger(quizId) || quizId <= 0) {
      return NextResponse.json({ error: "Valid quizId is required" }, { status: 400 });
    }
    if (!isArenaPowerId(powerType)) {
      return NextResponse.json({ error: "Invalid battle power" }, { status: 400 });
    }

    // Verify student is enrolled in this quiz
    const attempt = await prisma.studentQuiz.findFirst({
      where: {
        studentId: session.userId,
        quizId,
        quizStatus: { not: "rejected" },
      },
      include: {
        quiz: { select: { teacherId: true, quizStatus: true, title: true, quizMode: true } },
      },
      orderBy: { attemptNumber: "desc" },
    });

    if (!attempt) {
      return NextResponse.json(
        { error: "You are not an active participant in this quiz" },
        { status: 403 },
      );
    }

    // Strict Arena mode guards
    if (attempt.quiz.quizMode !== "arena" || attempt.attemptMode !== "arena") {
      return NextResponse.json(
        {
          error: "Battle powers are disabled in proctored examinations.",
          code: "INVALID_QUIZ_MODE",
        },
        { status: 403 },
      );
    }

    const arena = await getArenaState(quizId);
    if (arena && Array.isArray(arena.enabledPowers) && !arena.enabledPowers.includes(powerType)) {
      return NextResponse.json(
        { error: "That battle power is disabled for this arena" },
        { status: 403 },
      );
    }

    // Prevent rapid double-clicking with a 4-second cooldown per power type
    const rateLimit = await consumeRateLimit(
      `arena-power:${session.userId}:${quizId}:${powerType}`,
      1,
      4_000,
    );
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: `Please wait ${rateLimit.retryAfterSeconds}s before using ${powerType} again` },
        { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
      );
    }

    const teacherId = attempt.quiz.teacherId;
    const sessionId = arena?.sessionId || `arena-${quizId}`;

    const eventData = {
      attackerId: session.userId,
      attackerName: session.fullName || "A rival student",
      targetId: powerType === "shield" ? session.userId : "all",
      targetName: powerType === "shield" ? (session.fullName || "A rival student") : "Rival Students",
      powerType,
      questionId,
      sessionId,
      timestamp: new Date().toISOString(),
    };

    try {
      await Promise.allSettled([
        // Primary Arena-exclusive realtime channel
        pusherServer.trigger(`private-arena-${quizId}`, "battle-attack", eventData),
        // Teacher host realtime channel
        pusherServer.trigger(`private-teacher-${teacherId}`, "battle-attack", eventData),
      ]);
    } catch (error) {
      console.error("Battle action realtime broadcast failed:", error);
      return NextResponse.json({ error: "Battle action could not be delivered" }, { status: 503 });
    }

    return NextResponse.json({ success: true, ...eventData });
  } catch (error) {
    console.error("Arena battle action API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
