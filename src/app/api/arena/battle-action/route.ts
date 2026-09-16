import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { getSession } from "@/lib/auth";
import {
  computeArenaRankings,
  ensureArenaParticipant,
  getArenaState,
  getPowerPenalty,
  isArenaPowerId,
  setArenaState,
  type ArenaParticipant,
  type ArenaPowerId,
  type PendingAttack,
} from "@/lib/arena";
import prisma from "@/lib/prisma";
import { pusherServer } from "@/lib/pusher";
import { consumeRateLimit } from "@/lib/security";

const REACTION_WINDOW_MS = 2500;

// Resolve an expired pending attack into a confirmed hit with score deduction
async function applyPendingAttackHit(quizId: number, attackId: string) {
  const arena = await getArenaState(quizId);
  if (!arena || arena.status !== "active" || !arena.pendingAttacks) return null;

  const attack = arena.pendingAttacks[attackId];
  if (!attack || attack.status !== "pending") return null;

  // Mark attack as hit
  attack.status = "hit";
  if (!arena.participants) arena.participants = {};

  const target = arena.participants[attack.targetStudentId];
  const penalty = attack.scorePenalty || attack.damage || 40;
  if (target) {
    // Score must never drop below zero
    target.score = Math.max(0, target.score - penalty);
  }

  // Recompute rankings dynamically across all participants
  const updatedRankings = computeArenaRankings(arena.participants);

  const hitEventData = {
    attackId: attack.attackId,
    attackerId: attack.attackerId,
    attackerName: attack.attackerName,
    targetStudentId: attack.targetStudentId,
    targetName: attack.targetName,
    powerType: attack.powerType,
    scorePenalty: penalty,
    damage: penalty, // backwards compatibility
    targetCurrentScore: target ? target.score : 0,
    targetRank: target ? target.rank : 1,
    participants: updatedRankings,
    timestamp: new Date().toISOString(),
  };

  // Broadcast hit events and persist state concurrently
  const broadcastPromise = Promise.allSettled([
    pusherServer.trigger(
      [`private-arena-${quizId}`, `private-teacher-${arena.teacherId}`],
      "arena-attack-hit",
      hitEventData,
    ),
    pusherServer.trigger(`private-arena-${quizId}`, "attack-hit", hitEventData),
    pusherServer.trigger(`private-arena-${quizId}`, "arena-score-updated", {
      quizId,
      studentId: attack.targetStudentId,
      score: target ? target.score : 0,
      rank: target ? target.rank : 1,
      totalCount: updatedRankings.length,
      penalty,
    }),
    pusherServer.trigger(`private-arena-${quizId}`, "arena-leaderboard-updated", {
      quizId,
      participants: updatedRankings,
    }),
  ]);

  const persistPromise = setArenaState(arena);

  try {
    await Promise.all([broadcastPromise, persistPromise]);
  } catch (err) {
    console.error("Failed to broadcast attack-hit event:", err);
  }

  return hitEventData;
}

// POST /api/arena/battle-action — authoritative realtime targeted score-based combat
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
    const rawPower = (record?.powerType || record?.action) as unknown;
    const targetStudentId = typeof record?.targetStudentId === "string" ? record.targetStudentId.trim() : "";
    const defendAttackId = typeof record?.defendAttackId === "string" ? record.defendAttackId.trim() : "";
    const isResolveAction = record?.action === "resolve-attack" && typeof record?.attackId === "string";

    if (!Number.isSafeInteger(quizId) || quizId <= 0) {
      return NextResponse.json({ error: "Valid quizId is required" }, { status: 400 });
    }

    // Handle manual/client trigger to resolve an expired attack
    if (isResolveAction) {
      const result = await applyPendingAttackHit(quizId, record.attackId as string);
      return NextResponse.json({ success: true, resolved: true, hit: result });
    }

    if (!isArenaPowerId(rawPower)) {
      return NextResponse.json({ error: "Invalid battle power" }, { status: 400 });
    }
    const powerType = rawPower as ArenaPowerId;

    // Parallelize student enrollment validation and arena state retrieval
    const [attempt, arena] = await Promise.all([
      prisma.studentQuiz.findFirst({
        where: {
          studentId: session.userId,
          quizId,
          quizStatus: { not: "rejected" },
        },
        select: {
          attemptMode: true,
          quiz: { select: { teacherId: true, quizStatus: true, title: true, quizMode: true } },
        },
        orderBy: { attemptNumber: "desc" },
      }),
      getArenaState(quizId),
    ]);

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

    if (!arena || arena.status === "lobby") {
      return NextResponse.json(
        { error: "Arena has not started yet. Wait for teacher to start.", code: "ARENA_NOT_STARTED" },
        { status: 409 },
      );
    }

    if (arena.status === "ended" || (arena.matchEndsAt && Date.now() >= Date.parse(arena.matchEndsAt))) {
      return NextResponse.json(
        { error: "Arena match has already ended.", code: "ARENA_ENDED" },
        { status: 409 },
      );
    }

    // Validate current session identifier if provided
    if (record?.sessionId && typeof record.sessionId === "string" && arena.sessionId !== record.sessionId) {
      return NextResponse.json(
        { error: "Stale Arena session. Please refresh to join the current match.", code: "STALE_ARENA_SESSION" },
        { status: 409 },
      );
    }

    // Attacker must have joined the current Arena session
    if (!arena.participants || !arena.participants[session.userId]) {
      return NextResponse.json(
        { error: "You are not an active participant in this Arena session.", code: "NOT_ARENA_PARTICIPANT" },
        { status: 403 },
      );
    }

    if (Array.isArray(arena.enabledPowers) && !arena.enabledPowers.includes(powerType)) {
      return NextResponse.json(
        { error: "That battle power is disabled for this arena" },
        { status: 403 },
      );
    }

    if (!arena.usedPowers) arena.usedPowers = {};
    if (!arena.usedPowers[session.userId]) arena.usedPowers[session.userId] = {};
    if (!arena.pendingAttacks) arena.pendingAttacks = {};

    // ─────────────────────────────────────────────────────────────
    // RULE 13 & 14: EVERY POWER IS ONCE PER STUDENT PER MATCH
    // ─────────────────────────────────────────────────────────────
    if (arena.usedPowers[session.userId][powerType]) {
      const powerNames: Record<ArenaPowerId, string> = {
        meteor: "Meteor Strike",
        earthquake: "Earthquake",
        blizzard: "Blizzard",
        shield: "Guardian Shield",
      };
      return NextResponse.json(
        {
          error: `${powerNames[powerType]} has already been used in this match.`,
          code: "POWER_ALREADY_USED",
        },
        { status: 409 },
      );
    }

    // ─────────────────────────────────────────────────────────────
    // CASE 1: GUARDIAN SHIELD (SELF-TARGETED & DEFLECTION)
    // ─────────────────────────────────────────────────────────────
    if (powerType === "shield") {
      let attackToDefend: PendingAttack | null = null;
      if (defendAttackId && arena.pendingAttacks[defendAttackId]) {
        attackToDefend = arena.pendingAttacks[defendAttackId];
      } else {
        const now = Date.now();
        attackToDefend = Object.values(arena.pendingAttacks).find(
          (a) => a.targetStudentId === session.userId && a.status === "pending" && a.expiresAt >= now,
        ) || null;
      }

      arena.usedPowers[session.userId].shield = true;

      if (attackToDefend && attackToDefend.targetStudentId === session.userId && attackToDefend.status === "pending") {
        const now = Date.now();
        if (now <= attackToDefend.expiresAt) {
          // Valid deflection within reaction window! Zero score deduction.
          attackToDefend.status = "deflected";
          if (arena.participants[session.userId]) {
            arena.participants[session.userId].hasShield = false;
          }

          const deflectEventData = {
            attackId: attackToDefend.attackId,
            attackerId: attackToDefend.attackerId,
            attackerName: attackToDefend.attackerName,
            targetStudentId: session.userId,
            targetName: session.fullName,
            powerType: attackToDefend.powerType,
            status: "deflected",
            timestamp: new Date().toISOString(),
          };

          // Dispatch deflect broadcast and persist in parallel
          const deflectBroadcast = Promise.allSettled([
            pusherServer.trigger(
              [`private-arena-${quizId}`, `private-teacher-${arena.teacherId}`],
              "arena-attack-deflected",
              deflectEventData,
            ),
            pusherServer.trigger(
              [`private-arena-${quizId}`, `private-teacher-${arena.teacherId}`],
              "arena-attack-blocked",
              deflectEventData,
            ),
            pusherServer.trigger(`private-arena-${quizId}`, "attack-deflected", deflectEventData),
            pusherServer.trigger(`private-arena-${quizId}`, "attack-blocked", deflectEventData),
          ]);
          const persistDeflect = setArenaState(arena);

          await Promise.all([deflectBroadcast, persistDeflect]);

          return NextResponse.json({
            success: true,
            deflected: true,
            attackId: attackToDefend.attackId,
            powerType: "shield",
          });
        }
      }

      // Pre-arm the shield for the next incoming attack
      if (arena.participants[session.userId]) {
        arena.participants[session.userId].hasShield = true;
      }

      const shieldArmData = {
        studentId: session.userId,
        studentName: session.fullName,
        hasShield: true,
        timestamp: new Date().toISOString(),
      };

      const shieldBroadcast = Promise.allSettled([
        pusherServer.trigger(
          [`private-arena-${quizId}`, `private-teacher-${arena.teacherId}`],
          "arena-shield-equipped",
          shieldArmData,
        ),
      ]);
      const persistShield = setArenaState(arena);

      await Promise.all([shieldBroadcast, persistShield]);

      return NextResponse.json({
        success: true,
        powerType: "shield",
        targetId: session.userId,
        hasShield: true,
      });
    }

    // ─────────────────────────────────────────────────────────────
    // CASE 2: OFFENSIVE POWERS (METEOR, EARTHQUAKE, BLIZZARD)
    // ─────────────────────────────────────────────────────────────
    if (!targetStudentId) {
      return NextResponse.json(
        { error: "Target student is required for offensive battle powers", code: "INVALID_TARGET" },
        { status: 400 },
      );
    }

    if (targetStudentId === session.userId) {
      return NextResponse.json(
        { error: "You cannot target yourself with an offensive power", code: "SELF_TARGET" },
        { status: 400 },
      );
    }

    // Target must be a currently joined participant in this Arena session
    const targetParticipant = arena.participants[targetStudentId];
    if (!targetParticipant) {
      return NextResponse.json(
        { error: "Target student is not a currently joined participant in this Arena session.", code: "INVALID_TARGET" },
        { status: 400 },
      );
    }

    const targetEnrollment = await prisma.studentQuiz.findFirst({
      where: { quizId, studentId: targetStudentId, quizStatus: { not: "rejected" } },
      select: { attemptMode: true },
    });
    if (!targetEnrollment || targetEnrollment.attemptMode !== "arena") {
      return NextResponse.json(
        { error: "Target student does not belong to this arena", code: "INVALID_TARGET" },
        { status: 400 },
      );
    }

    // Mark offensive power as USED permanently for this student in this match
    arena.usedPowers[session.userId][powerType] = true;

    // Create pending attack with authoritative server timestamps
    const attackId = `atk_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
    const scorePenalty = getPowerPenalty(powerType);
    const createdAt = Date.now();
    const expiresAt = createdAt + REACTION_WINDOW_MS;
    const warningExpiry = new Date(expiresAt).toISOString();

    const pendingAttack: PendingAttack = {
      attackId,
      attackerId: session.userId,
      attackerName: session.fullName || "A rival student",
      targetStudentId,
      targetName: targetParticipant.studentName || "Rival Student",
      powerType,
      scorePenalty,
      damage: scorePenalty,
      createdAt,
      expiresAt,
      status: "pending",
    };

    arena.pendingAttacks[attackId] = pendingAttack;

    // Incoming attack warning payload with authoritative server timestamps
    const incomingEventData = {
      attackId,
      attackerId: session.userId,
      attackerName: session.fullName || "A rival student",
      targetStudentId,
      targetName: targetParticipant.studentName,
      powerType,
      scorePenalty,
      damage: scorePenalty,
      questionId,
      createdAt,
      expiresAt,
      warningExpiry,
      reactionWindowMs: REACTION_WINDOW_MS,
      timestamp: new Date().toISOString(),
    };

    // ─────────────────────────────────────────────────────────────
    // DISPATCH REALTIME WARNING IMMEDIATELY (ASAP)
    // ─────────────────────────────────────────────────────────────
    const broadcastPromise = Promise.allSettled([
      pusherServer.trigger(
        [`private-arena-${quizId}`, `private-teacher-${attempt.quiz.teacherId}`],
        "arena-incoming-attack",
        incomingEventData,
      ),
      pusherServer.trigger(`private-arena-${quizId}`, "incoming-attack", incomingEventData),
    ]);

    // Persist authoritative Arena state in parallel
    const persistPromise = setArenaState(arena);

    // Schedule authoritative server-side resolution after reaction window closes
    setTimeout(async () => {
      try {
        await applyPendingAttackHit(quizId, attackId);
      } catch (err) {
        console.error("Scheduled attack resolution error:", err);
      }
    }, REACTION_WINDOW_MS + 100);

    // Concurrently wait for broadcast and state persistence
    await Promise.all([broadcastPromise, persistPromise]);

    return NextResponse.json({
      success: true,
      ...incomingEventData,
    });
  } catch (error) {
    console.error("Arena battle action API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
