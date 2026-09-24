import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  computeArenaRankings,
  createArenaAttackId,
  deflectArenaAttack,
  ensureArenaParticipant,
  getArenaState,
  getPowerPenalty,
  isArenaPowerId,
  resolveArenaAttack,
  setArenaState,
  type ArenaParticipant,
  type ArenaPowerId,
  type ArenaState,
  type PendingAttack,
} from "@/lib/arena";
import prisma from "@/lib/prisma";
import { pusherServer } from "@/lib/pusher";
import { consumeRateLimit } from "@/lib/security";
import { isQuizAvailable, quizNotAvailableResponse } from "@/lib/quiz-availability";

const REACTION_WINDOW_MS = 2500;

async function broadcastPendingAttackHit(
  quizId: number,
  arena: ArenaState,
  resolution: {
    attack: PendingAttack;
    target: ArenaParticipant;
    participants?: ArenaParticipant[];
    penalty?: number;
  },
) {
  const attack = resolution.attack;
  const target = resolution.target;
  const penalty = resolution.penalty ?? getPowerPenalty(attack.powerType);
  const updatedRankings = resolution.participants ?? computeArenaRankings(arena.participants);

  const hitEventData = {
    attackId: attack.attackId,
    sessionId: attack.sessionId || arena.sessionId,
    attackerId: attack.attackerId,
    attackerName: attack.attackerName,
    targetStudentId: attack.targetStudentId,
    targetId: attack.targetStudentId,
    targetName: attack.targetName,
    powerType: attack.powerType,
    scorePenalty: penalty,
    damage: penalty,
    targetCurrentScore: target.score,
    targetRank: target.rank,
    participants: updatedRankings,
    status: "hit",
    timestamp: new Date().toISOString(),
  };

  await Promise.allSettled([
    pusherServer.trigger(
      [`private-arena-${quizId}`, `private-teacher-${arena.teacherId}`],
      "arena-attack-hit",
      hitEventData,
    ),
    pusherServer.trigger(`private-arena-${quizId}`, "attack-hit", hitEventData),
    pusherServer.trigger(`private-arena-${quizId}`, "arena-score-updated", {
      quizId,
      studentId: attack.targetStudentId,
      score: target.score,
      rank: target.rank,
      totalCount: updatedRankings.length,
      penalty,
    }),
    pusherServer.trigger(`private-arena-${quizId}`, "arena-leaderboard-updated", {
      quizId,
      participants: updatedRankings,
    }),
  ]);

  return hitEventData;
}

// Resolve an expired pending attack into a confirmed hit with score deduction
async function applyPendingAttackHit(
  quizId: number,
  attackId: string,
  options: { resolverStudentId?: string; expectedTargetStudentId?: string } = {},
) {
  const { state: arena, resolution } = await resolveArenaAttack(quizId, attackId, options);
  if (!arena || resolution.code !== "resolved" || !resolution.attack || !resolution.target) {
    return { code: resolution.code, hit: null, attack: resolution.attack };
  }

  const hitEventData = await broadcastPendingAttackHit(quizId, arena, {
    attack: resolution.attack,
    target: resolution.target,
    participants: resolution.participants,
    penalty: resolution.penalty,
  });

  return { code: resolution.code, hit: hitEventData, attack: resolution.attack };
}

// POST /api/arena/battle-action — authoritative realtime targeted score-based combat
export async function POST(req: NextRequest) {
  const requestReceivedAt = Date.now();
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
    if (!isQuizAvailable(attempt.quiz.quizStatus)) {
      return NextResponse.json(quizNotAvailableResponse(), { status: 410 });
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

    if (isResolveAction) {
      const attackId = (record.attackId as string).trim();
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(attackId)) {
        return NextResponse.json({ error: "Invalid attack ID", code: "INVALID_ATTACK_ID" }, { status: 400 });
      }
      const result = await applyPendingAttackHit(quizId, attackId, {
        resolverStudentId: session.userId,
        expectedTargetStudentId: targetStudentId || undefined,
      });
      const code = result.code;
      if (code === "resolved" || code === "already_resolved") {
        return NextResponse.json({
          success: true,
          resolved: code === "resolved",
          code,
          attackId,
          attackStatus: result.attack?.status,
        });
      }
      if (code === "wrong_student" || code === "not_participant") {
        return NextResponse.json({ error: "You cannot resolve another student's attack", code }, { status: 403 });
      }
      if (code === "wrong_target" || code === "invalid_attack") {
        return NextResponse.json({ error: "Attack target does not match the pending action", code }, { status: 400 });
      }
      if (code === "premature") {
        return NextResponse.json({ error: "Attack reaction window is still active", code }, { status: 409 });
      }
      if (code === "arena_inactive") {
        return NextResponse.json({ error: "Arena match is no longer active", code }, { status: 409 });
      }
      return NextResponse.json({ error: "Pending attack not found", code }, { status: 404 });
    }

    if (!isArenaPowerId(rawPower)) {
      return NextResponse.json({ error: "Invalid battle power" }, { status: 400 });
    }
    const powerType = rawPower as ArenaPowerId;

    if (Array.isArray(arena.enabledPowers) && !arena.enabledPowers.includes(powerType)) {
      return NextResponse.json(
        { error: "That battle power is disabled for this arena" },
        { status: 403 },
      );
    }

    if (!arena.usedPowers) arena.usedPowers = {};
    if (!arena.usedPowers[session.userId]) arena.usedPowers[session.userId] = {};
    if (!arena.pendingAttacks) arena.pendingAttacks = {};

    if (powerType === "shield" && defendAttackId) {
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(defendAttackId)) {
        return NextResponse.json({ error: "Invalid attack ID", code: "invalid_attack" }, { status: 400 });
      }

      const { state: lockedArena, resolution } = await deflectArenaAttack(quizId, defendAttackId, {
        now: requestReceivedAt,
        defenderStudentId: session.userId,
      });
      const attackStatus = resolution.attack?.status;

      if (lockedArena && resolution.code === "blocked" && resolution.attack) {
        const deflectEventData = {
          attackId: resolution.attack.attackId,
          sessionId: resolution.attack.sessionId || lockedArena.sessionId,
          attackerId: resolution.attack.attackerId,
          attackerName: resolution.attack.attackerName,
          targetStudentId: resolution.attack.targetStudentId,
          targetId: resolution.attack.targetStudentId,
          targetName: resolution.attack.targetName,
          powerType: resolution.attack.powerType,
          status: "deflected",
          timestamp: new Date().toISOString(),
        };

        await Promise.allSettled([
          pusherServer.trigger(
            [`private-arena-${quizId}`, `private-teacher-${lockedArena.teacherId}`],
            "arena-attack-deflected",
            deflectEventData,
          ),
          pusherServer.trigger(
            [`private-arena-${quizId}`, `private-teacher-${lockedArena.teacherId}`],
            "arena-attack-blocked",
            deflectEventData,
          ),
          pusherServer.trigger(`private-arena-${quizId}`, "attack-deflected", deflectEventData),
          pusherServer.trigger(`private-arena-${quizId}`, "attack-blocked", deflectEventData),
        ]);

        return NextResponse.json({
          success: true,
          deflected: true,
          code: resolution.code,
          attackId: resolution.attack.attackId,
          attackStatus,
          sessionId: resolution.attack.sessionId || lockedArena.sessionId,
          powerType: "shield",
        });
      }

      if (
        lockedArena
        && resolution.code === "too_late"
        && resolution.resolvedHit
        && resolution.attack
        && resolution.target
      ) {
        await broadcastPendingAttackHit(quizId, lockedArena, {
          attack: resolution.attack,
          target: resolution.target,
          participants: resolution.participants,
          penalty: resolution.penalty,
        });
      }

      if (resolution.code === "already_resolved") {
        return NextResponse.json({ success: true, code: resolution.code, attackStatus });
      }
      if (resolution.code === "shield_already_used") {
        return NextResponse.json(
          { error: "Guardian Shield has already been used in this match.", code: resolution.code, attackStatus },
          { status: 409 },
        );
      }
      if (resolution.code === "too_late") {
        return NextResponse.json(
          { error: "Guardian Shield arrived after the reaction window.", code: resolution.code, attackStatus },
          { status: 409 },
        );
      }
      if (resolution.code === "wrong_student" || resolution.code === "not_participant") {
        return NextResponse.json({ error: "You cannot defend another student.", code: resolution.code }, { status: 403 });
      }
      if (resolution.code === "arena_inactive") {
        return NextResponse.json({ error: "Arena match is no longer active.", code: resolution.code }, { status: 409 });
      }
      return NextResponse.json({ error: "Pending attack not found.", code: resolution.code }, { status: 404 });
    }

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
      arena.usedPowers[session.userId].shield = true;

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
    const attackId = createArenaAttackId(arena.sessionId);
    const scorePenalty = getPowerPenalty(powerType);
    const createdAt = Date.now();
    const expiresAt = createdAt + REACTION_WINDOW_MS;
    const warningExpiry = new Date(expiresAt).toISOString();

    const pendingAttack: PendingAttack = {
      attackId,
      sessionId: arena.sessionId,
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
      sessionId: arena.sessionId,
      attackerId: session.userId,
      attackerName: session.fullName || "A rival student",
      targetStudentId,
      targetId: targetStudentId,
      targetName: targetParticipant.studentName,
      powerType,
      scorePenalty,
      damage: scorePenalty,
      questionId,
      createdAt,
      expiresAt,
      warningExpiry,
      reactionWindowMs: REACTION_WINDOW_MS,
      status: "pending",
      timestamp: new Date().toISOString(),
    };

    // ─────────────────────────────────────────────────────────────
    // DISPATCH REALTIME WARNING IMMEDIATELY (ASAP)
    // ─────────────────────────────────────────────────────────────
    await setArenaState(arena);

    const broadcastPromise = Promise.allSettled([
      pusherServer.trigger(
        [`private-arena-${quizId}`, `private-teacher-${attempt.quiz.teacherId}`],
        "arena-incoming-attack",
        incomingEventData,
      ),
      pusherServer.trigger(`private-arena-${quizId}`, "incoming-attack", incomingEventData),
    ]);

    // Schedule authoritative server-side resolution after reaction window closes
    setTimeout(async () => {
      try {
        await applyPendingAttackHit(quizId, attackId);
      } catch (err) {
        console.error("Scheduled attack resolution error:", err);
      }
    }, Math.max(0, expiresAt - Date.now() + 100));

    await broadcastPromise;

    return NextResponse.json({
      success: true,
      ...incomingEventData,
    });
  } catch (error) {
    console.error("Arena battle action API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
