import type { PrismaClient } from "@prisma/client";
import { computeArenaRankings, reconcileArenaAttacksInState, resolvePendingAttackInState, mutateArena, type ArenaMutation } from "./arena.ts";
import { arenaRealtime, broadcastArenaAttackHit } from "./arena-realtime.ts";
import { awardArenaExpOnce, getArenaExpAwarded, getStudentProgression, isArenaExpAlreadyAwarded, EXP_REWARDS } from "./student-progression.ts";

/** Resolve only combat that could legally have hit before the committed cutoff.
 * The normal resolver retains its strict now > expiresAt / now < matchEndsAt
 * rules. Do not use this from read endpoints or before a timely shield request.
 */
export async function recoverArenaAttacks(mutation: ArenaMutation, options: {
  cutoff?: number; allowUnfinalizedEnd?: boolean; preserveScoresFor?: ReadonlySet<string>; limit?: number;
} = {}) {
  const state = mutation.state;
  if (!state || state.finalizedAt) return 0;
  const deadline = state.matchEndsAt ? Date.parse(state.matchEndsAt) : Infinity;
  const now = Math.min(mutation.now, options.cutoff ?? mutation.now, Number.isFinite(deadline) ? deadline - 1 : Infinity);
  if (!Number.isFinite(now)) throw new Error("Arena combat cutoff is unavailable");
  const resolved = reconcileArenaAttacksInState(state, now, options);
  // Queue final post-batch participants, not intermediate same-revision scores.
  const participants = computeArenaRankings(state.participants);
  for (const resolution of resolved) {
    if (resolution.attack && resolution.target) await broadcastArenaAttackHit(state.quizId, state, {
      attack: resolution.attack, target: resolution.target, participants, penalty: resolution.penalty,
    }, arenaRealtime(mutation));
  }
  return resolved.length;
}

export function arenaNeedsFinalization(mutation: ArenaMutation): boolean {
  const state = mutation.state;
  return !!state && !state.finalizedAt && (state.status === "ended"
    || (state.status === "active" && !!state.matchEndsAt && mutation.now >= Date.parse(state.matchEndsAt)));
}

/** Caller owns the existing Arena quiz advisory lock/transaction. Never start
 * a second transaction here. The participant snapshot is authoritative; client
 * submission answers, percentage grading and caches cannot replace it.
 */
export async function finalizeArena(mutation: ArenaMutation) {
  const { tx, state } = mutation;
  if (!state) throw new Error("Arena state is missing");
  if (state.finalizedAt) return state.payouts ?? [];
  const quiz = await tx.quiz.findUnique({ where: { id: state.quizId } });
  if (!quiz || quiz.quizMode !== "arena" || quiz.teacherId !== state.teacherId
    || !["in_progress", "ended"].includes(quiz.quizStatus)) throw new Error("Arena cannot be finalized");

  const legacyEnd = state.status === "ended" || quiz.quizStatus === "ended";
  const ids = Object.keys(state.participants).sort();
  // Arena -> all progression locks in lexical order -> award marker -> attempts.
  // Bootstrap/award precedes completion so a new completion is not counted as
  // historical EXP by getStudentProgression's compatibility bootstrap.
  for (const id of ids) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`student-progression:${id}`}))`;
  }
  const attempts = await tx.studentQuiz.findMany({
    where: { quizId: state.quizId, attemptMode: "arena" },
    orderBy: { attemptNumber: "desc" },
  });
  const latest = new Map<string, typeof attempts[number]>();
  for (const attempt of attempts) if (!latest.has(attempt.studentId)) latest.set(attempt.studentId, attempt);
  // Completed legacy points are durable facts. Adoption must not regrade them
  // or overwrite them from a snapshot that predates the old completion.
  for (const id of ids) {
    const attempt = latest.get(id);
    if (legacyEnd && attempt?.quizStatus === "completed" && attempt.score !== null
      && Number.isFinite(Number(attempt.score))) state.participants[id].score = Number(attempt.score);
  }
  const historicalTimes = [...latest.values()].filter((a) => a.quizStatus === "completed" && a.endTime)
    .map((a) => a.endTime!.getTime()).sort((a, b) => a - b);
  const deadline = state.matchEndsAt ? Date.parse(state.matchEndsAt) : NaN;
  const persistedEnd = state.endedAt ? Date.parse(state.endedAt) : historicalTimes[0];
  const recordedExpiry = [...latest.values()].some((a) => a.quizStatus === "completed"
    && ["Arena match submitted automatically after the time limit expired.",
      "Quiz submitted automatically after the time limit expired."].includes(a.remarks || ""));
  // Recovery time is not evidence of why a historical match ended.
  const reason = state.completionReason ?? (legacyEnd
    ? (Number.isFinite(persistedEnd) && Number.isFinite(deadline)
      ? (persistedEnd >= deadline ? "timer_expiry" : "teacher_end") : recordedExpiry ? "timer_expiry" : "recovered")
    : (Number.isFinite(deadline) && mutation.now >= deadline ? "timer_expiry" : "teacher_end"));
  const endedAt = state.endedAt || new Date(Number.isFinite(persistedEnd) ? persistedEnd : mutation.now).toISOString();
  const preserveScoresFor = new Set(ids.filter((id) => {
    const attempt = latest.get(id);
    return legacyEnd && attempt?.quizStatus === "completed" && attempt.score !== null && Number.isFinite(Number(attempt.score));
  }));
  // Combat settles before rankings, attempts and rewards in the SAME transaction.
  // Valid historical completed scores remain immutable facts.
  await recoverArenaAttacks(mutation, { cutoff: Date.parse(endedAt), allowUnfinalizedEnd: legacyEnd, preserveScoresFor });
  const ranked = computeArenaRankings(state.participants);
  let repaired = false;
  const payouts: Array<{ studentId: string; rank: number; amount: number }> = [];
  for (const id of ids) {
    const participant = state.participants[id];
    const attempt = latest.get(id);
    if (!attempt || ["pending_approval", "rejected"].includes(attempt.quizStatus || "")
      || !Number.isFinite(participant.score)) throw new Error("Arena participant result is unavailable");
    const bonus = participant.rank === 1 ? EXP_REWARDS.ARENA_RANK_1
      : participant.rank === 2 ? EXP_REWARDS.ARENA_RANK_2
        : participant.rank === 3 ? EXP_REWARDS.ARENA_RANK_3 : 0;
    const amount = EXP_REWARDS.ARENA_PARTICIPATION + bonus;
    // An older expiry/submit may already have completed this attempt without
    // an award. Exclude this match from legacy history bootstrap when repairing
    // it; its explicit once-only award supplies the EXP instead.
    if (!await isArenaExpAlreadyAwarded(state.sessionId, id, tx)) {
      await getStudentProgression(id, tx, [attempt.id]);
      await awardArenaExpOnce(state.sessionId, id, amount, `Arena Match Completion (Rank #${participant.rank})`, tx);
      repaired = true;
    }
    payouts.push({ studentId: id, rank: participant.rank, amount: await getArenaExpAwarded(state.sessionId, id, tx) });
  }
  for (const attempt of latest.values()) {
    const participant = state.participants[attempt.studentId];
    // Preserve the existing End behavior for in-progress enrolled non-players,
    // but give them zero points and no participation award. Historical attempts
    // and proctored attempts are never rewritten.
    if (!participant && attempt.quizStatus !== "in_progress") continue;
    const completed = attempt.quizStatus === "completed";
    if (legacyEnd && completed && attempt.score !== null && attempt.endTime) continue;
    repaired = true;
    await tx.studentQuiz.update({ where: { id: attempt.id }, data: {
      score: legacyEnd && completed && attempt.score !== null ? attempt.score : participant?.score ?? 0,
      quizStatus: "completed", endTime: attempt.endTime ?? new Date(endedAt),
      // Existing legacy metadata (including a deliberately blank remark) is
      // preserved even when a missing score/reward needs repair.
      ...(!legacyEnd ? { aiVerdict: null, cheatingProbability: null,
        remarks: reason === "timer_expiry" && !attempt.remarks
          ? "Arena match submitted automatically after the time limit expired." : attempt.remarks } : {}),
    } });
  }
  const realtime = arenaRealtime(mutation);
  for (const participant of ranked) {
    const attempt = latest.get(participant.studentId)!;
    if (legacyEnd && attempt.quizStatus === "completed" && attempt.endTime) continue;
    await tx.notification.createMany({ data: [
      { userId: state.teacherId, title: "Power Arena Match Completed",
        message: `${participant.studentName} completed Power Arena "${quiz.title}" with a score of ${participant.score} points.` },
      { userId: participant.studentId, title: "Arena Match Completed",
        message: `You completed Power Arena "${quiz.title}". Score: ${participant.score} points.` },
    ] });
    await realtime.trigger(`private-teacher-${state.teacherId}`, "student-submitted", {
      studentId: participant.studentId, studentName: participant.studentName,
      quizId: state.quizId, quizTitle: quiz.title, attemptMode: "arena", score: participant.score, timestamp: endedAt,
    });
    await realtime.trigger("private-admin-dashboard", "activity", {
      type: "arena-submit", userId: participant.studentId, fullName: participant.studentName, role: "student",
      activity: `Power Arena completed: ${quiz.title} by ${participant.studentName}`, timestamp: endedAt,
    });
  }
  if (quiz.quizStatus !== "ended") await tx.quiz.update({ where: { id: state.quizId }, data: { quizStatus: "ended" } });
  state.status = "ended";
  state.endedAt = endedAt;
  state.completionReason = reason;
  for (const attack of Object.values(state.pendingAttacks ?? {})) {
    if (attack.status === "pending") attack.status = "cancelled";
  }
  state.attackResults = { ...state.attackResults, ...state.pendingAttacks };
  state.pendingAttacks = {};
  state.payouts = payouts.sort((a, b) => a.rank - b.rank);
  state.finalizedAt = new Date(mutation.now).toISOString();
  // The final snapshot/marker is saved by mutateArena in this same transaction.
  // Register exactly one result event; rollback cannot publish it.
  if (!legacyEnd || repaired) await realtime.trigger(`private-arena-${state.quizId}`, "arena-end", {
    quizId: state.quizId, arena: state, status: state.status, sessionId: state.sessionId,
    participants: ranked, payouts: state.payouts, teacherId: state.teacherId, timestamp: endedAt,
    mode: state.mode, matchDuration: state.matchDuration, matchEndsAt: state.matchEndsAt,
    waveDuration: state.matchDuration, enabledPowers: state.enabledPowers, totalQuestions: state.totalQuestions,
  });
  return state.payouts;
}

export async function recoverArenaFinalization(mutation: ArenaMutation, quizStatus?: string) {
  if (arenaNeedsFinalization(mutation) || (quizStatus === "ended" && mutation.state && !mutation.state.finalizedAt)) {
    await finalizeArena(mutation);
  }
}

/** Fast scheduled callback and durable sweep share the same lock/finalizer. */
export async function resolveArenaAttackDurably(quizId: number, attackId: string, options: {
  resolverStudentId?: string; expectedTargetStudentId?: string;
} = {}, client?: PrismaClient) {
  return mutateArena(quizId, async (mutation) => {
    await recoverArenaFinalization(mutation);
    const state = mutation.state;
    const resolution = state ? resolvePendingAttackInState(state, attackId, options) : { code: "attack_not_found" as const };
    if (!state || resolution.code !== "resolved" || !resolution.attack || !resolution.target) {
      return { code: resolution.code, attack: resolution.attack, hit: null };
    }
    const hit = await broadcastArenaAttackHit(quizId, state, {
      attack: resolution.attack, target: resolution.target, participants: resolution.participants, penalty: resolution.penalty,
    }, arenaRealtime(mutation));
    return { code: resolution.code, attack: resolution.attack, hit };
  }, client);
}
