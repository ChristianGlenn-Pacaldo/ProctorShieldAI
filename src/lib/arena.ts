import crypto from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { getRedis, isRedisReady } from "./redis.ts";
import prisma from "./prisma.ts";
import { getStudentInitials } from "./student-identity.ts";

export const ARENA_MODES = ["score_arena", "battle_royale", "wave_sprint"] as const;
export const ARENA_POWER_IDS = ["meteor", "earthquake", "blizzard", "shield"] as const;
export const ARENA_ACTIONS = ["start", "join", "wave", "airdrop", "end", "reset", "create_session"] as const;

export type ArenaMode = (typeof ARENA_MODES)[number];
export type ArenaPowerId = (typeof ARENA_POWER_IDS)[number];
export type ArenaAction = (typeof ARENA_ACTIONS)[number];
export type ArenaStatus = "lobby" | "active" | "ended";

export const VALID_MATCH_DURATIONS = [1800, 3600] as const;
export const DEFAULT_MATCH_DURATION = 1800; // 30 Minutes default

export function normalizeMatchDuration(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (parsed === 1800 || parsed === 3600) return parsed;
  // If legacy minutes provided: 30 min -> 1800s, 60 min -> 3600s
  if (parsed === 30) return 1800;
  if (parsed === 60) return 3600;
  return DEFAULT_MATCH_DURATION;
}

export const POWER_SCORE_PENALTIES: Record<ArenaPowerId, number> = {
  meteor: 100,
  earthquake: 60,
  blizzard: 40,
  shield: 0,
};

export function getPowerPenalty(power: ArenaPowerId): number {
  return POWER_SCORE_PENALTIES[power] ?? 40;
}

// Backwards compatibility alias for existing code
export function getPowerDamage(power: ArenaPowerId): number {
  return getPowerPenalty(power);
}

export function createArenaAttackId(sessionId: string): string {
  return `atk_${sessionId}_${crypto.randomUUID()}`;
}

export interface ArenaParticipant {
  studentId: string;
  studentName: string;
  initials: string;
  score: number;
  rank: number;
  questionsAnswered: number;
  totalQuestions: number;
  isFinished: boolean;
  finishedAt?: string;
  hasShield?: boolean;
  isAi?: boolean;
}

export interface PendingAttack {
  attackId: string;
  sessionId?: string;
  attackerId: string;
  attackerName: string;
  targetStudentId: string;
  targetName: string;
  powerType: ArenaPowerId;
  scorePenalty: number;
  damage?: number; // backwards compatibility alias
  createdAt: number;
  expiresAt: number;
  status: "pending" | "deflected" | "hit" | "cancelled";
}

export interface ArenaState {
  revision?: number;
  actionReceipts?: Record<string, string>;
  sessionId: string;
  quizId: number;
  teacherId: string;
  status: ArenaStatus; // "lobby" | "active" | "ended"
  mode: ArenaMode;
  matchDuration: number; // overall match duration in seconds (1800 or 3600)
  matchEndsAt?: string | null;
  enabledPowers: ArenaPowerId[];
  totalQuestions: number;
  startedAt?: string | null;
  endedAt?: string | null;
  participants: Record<string, ArenaParticipant>;
  usedPowers: Record<string, Record<string, boolean>>; // studentId -> powerId -> boolean
  pendingAttacks?: Record<string, PendingAttack>;
  // Deprecated wave fields preserved for compatibility during transition
  currentWave?: number;
  currentQuestionId?: number;
  waveDuration?: number;
  waveStartedAt?: string | null;
  waveEndsAt?: string | null;
  players?: Record<string, ArenaParticipant>;
}

export type ArenaAttackResolutionCode =
  | "resolved"
  | "arena_inactive"
  | "attack_not_found"
  | "not_participant"
  | "wrong_student"
  | "wrong_target"
  | "invalid_attack"
  | "premature"
  | "already_resolved";

export interface ArenaAttackResolution {
  code: ArenaAttackResolutionCode;
  attack?: PendingAttack;
  target?: ArenaParticipant;
  participants?: ArenaParticipant[];
  penalty?: number;
}

export type ArenaShieldResolutionCode =
  | "blocked"
  | "too_late"
  | "already_resolved"
  | "shield_already_used"
  | "arena_inactive"
  | "attack_not_found"
  | "not_participant"
  | "wrong_student"
  | "invalid_attack";

export interface ArenaShieldResolution {
  code: ArenaShieldResolutionCode;
  attack?: PendingAttack;
  target?: ArenaParticipant;
  participants?: ArenaParticipant[];
  penalty?: number;
  resolvedHit?: boolean;
}

const globalArena = globalThis as typeof globalThis & {
  __proctorShieldArenaState?: Map<number, { value: ArenaState; expiresAt: number }>;
};
if (!globalArena.__proctorShieldArenaState) {
  globalArena.__proctorShieldArenaState = new Map();
}

const validModes = new Set<string>(ARENA_MODES);
const validPowers = new Set<string>(ARENA_POWER_IDS);
const validActions = new Set<string>(ARENA_ACTIONS);

export function isArenaAction(value: unknown): value is ArenaAction {
  return typeof value === "string" && (validActions.has(value) || value === "wave" || value === "join");
}

export function isArenaPowerId(value: unknown): value is ArenaPowerId {
  return typeof value === "string" && validPowers.has(value);
}

function allowedNumber(value: unknown, allowed: readonly number[], fallback: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  return allowed.includes(parsed) ? parsed : fallback;
}

export function normalizeArenaConfig(input: unknown): Pick<
  ArenaState,
  "mode" | "waveDuration" | "enabledPowers"
> {
  const record = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const mode =
    typeof record.mode === "string" && validModes.has(record.mode)
      ? (record.mode as ArenaMode)
      : "score_arena";
  const requestedPowers = Array.isArray(record.enabledPowers) ? record.enabledPowers : [];
  const enabledPowers = Array.from(new Set(requestedPowers.filter(isArenaPowerId)));

  return {
    mode,
    waveDuration: allowedNumber(record.waveDuration, [20, 30, 45], 30),
    enabledPowers: enabledPowers.length > 0 ? enabledPowers : [...ARENA_POWER_IDS],
  };
}

/**
 * Deterministic rankings calculator:
 * Primary: score descending
 * Secondary: questions answered descending
 * Tertiary: finishedAt ascending (earlier finish)
 * Fallback: studentName ascending
 */
export function computeArenaRankings(
  participants: Record<string, ArenaParticipant>,
): ArenaParticipant[] {
  const list = Object.values(participants);
  list.forEach((participant) => {
    participant.initials = getStudentInitials(participant.studentName, "ST");
    delete (participant as ArenaParticipant & { avatar?: unknown }).avatar;
  });
  list.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.questionsAnswered !== a.questionsAnswered) return b.questionsAnswered - a.questionsAnswered;
    if (a.finishedAt && b.finishedAt) {
      const diff = Date.parse(a.finishedAt) - Date.parse(b.finishedAt);
      if (diff !== 0) return diff;
    } else if (a.finishedAt && !b.finishedAt) {
      return -1;
    } else if (!a.finishedAt && b.finishedAt) {
      return 1;
    }
    return a.studentName.localeCompare(b.studentName);
  });
  list.forEach((p, idx) => {
    p.rank = idx + 1;
  });
  return list;
}

export function resolvePendingAttackInState(
  state: ArenaState,
  attackId: string,
  options: {
    now?: number;
    resolverStudentId?: string;
    expectedTargetStudentId?: string;
  } = {},
): ArenaAttackResolution {
  const now = options.now ?? Date.now();
  if (state.status !== "active" || (state.matchEndsAt && now >= Date.parse(state.matchEndsAt))) {
    return { code: "arena_inactive" };
  }

  const attack = state.pendingAttacks?.[attackId];
  if (!attack) return { code: "attack_not_found" };

  if (options.resolverStudentId) {
    if (!state.participants?.[options.resolverStudentId]) return { code: "not_participant", attack };
    if (attack.targetStudentId !== options.resolverStudentId) return { code: "wrong_student", attack };
  }
  if (options.expectedTargetStudentId && attack.targetStudentId !== options.expectedTargetStudentId) {
    return { code: "wrong_target", attack };
  }
  if (!state.participants?.[attack.attackerId] || !state.participants?.[attack.targetStudentId]) {
    return { code: "invalid_attack", attack };
  }
  if (attack.status !== "pending") return { code: "already_resolved", attack };
  if (now <= attack.expiresAt) return { code: "premature", attack };

  const target = state.participants[attack.targetStudentId];
  const penalty = getPowerPenalty(attack.powerType);
  attack.scorePenalty = penalty;
  attack.damage = penalty;
  attack.status = "hit";
  target.score = Math.max(0, target.score - penalty);
  const participants = computeArenaRankings(state.participants);

  return { code: "resolved", attack, target, participants, penalty };
}

export function deflectPendingAttackInState(
  state: ArenaState,
  attackId: string,
  options: { now?: number; defenderStudentId: string },
): ArenaShieldResolution {
  const now = options.now ?? Date.now();
  if (state.status !== "active" || (state.matchEndsAt && now >= Date.parse(state.matchEndsAt))) {
    return { code: "arena_inactive" };
  }

  const attack = state.pendingAttacks?.[attackId];
  if (!attack) return { code: "attack_not_found" };

  const defender = state.participants?.[options.defenderStudentId];
  if (!defender) return { code: "not_participant", attack };
  if (attack.targetStudentId !== options.defenderStudentId) {
    return { code: "wrong_student", attack };
  }
  if (!state.participants?.[attack.attackerId]) {
    return { code: "invalid_attack", attack };
  }
  if (attack.status !== "pending") {
    return { code: "already_resolved", attack, target: defender };
  }

  if (now > attack.expiresAt) {
    const hit = resolvePendingAttackInState(state, attackId, {
      now,
      resolverStudentId: options.defenderStudentId,
      expectedTargetStudentId: options.defenderStudentId,
    });
    if (hit.code === "resolved") {
      return {
        code: "too_late",
        attack: hit.attack,
        target: hit.target,
        participants: hit.participants,
        penalty: hit.penalty,
        resolvedHit: true,
      };
    }
    return { code: "already_resolved", attack, target: defender };
  }

  if (state.usedPowers?.[options.defenderStudentId]?.shield) {
    return { code: "shield_already_used", attack, target: defender };
  }

  if (!state.usedPowers) state.usedPowers = {};
  if (!state.usedPowers[options.defenderStudentId]) state.usedPowers[options.defenderStudentId] = {};
  state.usedPowers[options.defenderStudentId].shield = true;
  attack.status = "deflected";
  defender.hasShield = false;

  return {
    code: "blocked",
    attack,
    target: defender,
    participants: computeArenaRankings(state.participants),
    penalty: 0,
  };
}

export function createArenaState(params: {
  quizId: number;
  teacherId: string;
  status?: ArenaStatus;
  totalQuestions?: number;
  currentQuestionId?: number;
  config?: Partial<ReturnType<typeof normalizeArenaConfig>> | Record<string, unknown>;
  sessionId?: string;
}): ArenaState {
  const config = normalizeArenaConfig(params.config);
  const status: ArenaStatus = params.status || "lobby";
  const rawRecord = params.config && typeof params.config === "object" ? (params.config as Record<string, unknown>) : {};
  const rawDuration = rawRecord.matchDuration ?? rawRecord.duration;
  const matchDuration = normalizeMatchDuration(rawDuration);
  const startedAt = status === "active" ? new Date().toISOString() : "";
  const matchEndsAt = status === "active" ? new Date(Date.now() + matchDuration * 1000).toISOString() : undefined;

  const state: ArenaState = {
    sessionId: params.sessionId || crypto.randomUUID(),
    quizId: params.quizId,
    teacherId: params.teacherId,
    status,
    ...config,
    matchDuration,
    matchEndsAt,
    totalQuestions: params.totalQuestions || 0,
    startedAt,
    endedAt: null,
    participants: {},
    usedPowers: {},
    pendingAttacks: {},
    // Compatibility fields
    currentWave: 0,
    currentQuestionId: params.currentQuestionId || 0,
    waveStartedAt: startedAt,
    waveEndsAt: matchEndsAt,
  };
  state.players = state.participants;
  return state;
}

export function ensureArenaParticipant(
  state: ArenaState,
  player: { studentId: string; studentName: string; isAi?: boolean },
): ArenaParticipant {
  if (!state.participants) state.participants = {};
  if (!state.players) state.players = state.participants;
  const existing = state.participants[player.studentId];
  if (existing) {
    if (player.studentName) existing.studentName = player.studentName;
    existing.initials = getStudentInitials(existing.studentName, "ST");
    delete (existing as ArenaParticipant & { avatar?: unknown }).avatar;
    return existing;
  }
  const created: ArenaParticipant = {
    studentId: player.studentId,
    studentName: player.studentName || "Fighter",
    initials: getStudentInitials(player.studentName || "Fighter", "ST"),
    score: 0,
    rank: Object.keys(state.participants).length + 1,
    questionsAnswered: 0,
    totalQuestions: state.totalQuestions || 0,
    isFinished: false,
    hasShield: false,
    isAi: player.isAi,
  };
  state.participants[player.studentId] = created;
  computeArenaRankings(state.participants);
  return created;
}

// Backwards compatibility alias
export const ensureArenaPlayer = ensureArenaParticipant;
export type PlayerHealth = ArenaParticipant;

function arenaKey(quizId: number) {
  return `proctorshield:arena:${quizId}`;
}

function arenaSettingKey(quizId: number) {
  return `arena:state:${quizId}`;
}

export interface ArenaMutation {
  tx: Prisma.TransactionClient;
  state: ArenaState | null;
  now: number;
  afterCommit: (effect: () => Promise<unknown>) => void;
}

async function invalidateArenaCaches(quizId: number) {
  // Never publish snapshots here: an older transaction's delayed cache write
  // could otherwise replace a newer commit. Readers use PostgreSQL only.
  globalArena.__proctorShieldArenaState?.delete(quizId);
  try {
    const redis = getRedis();
    if (isRedisReady(redis)) await redis.del(arenaKey(quizId));
  } catch {
    console.warn("Arena cache invalidation failed (PostgreSQL remains authoritative)");
  }
}

/**
 * The only Arena persistence boundary. Arena quiz lock always comes first,
 * then the answer lock (answers) or sorted progression locks (finalizers).
 * Finalizers acquire progression locks before attempt writes; each reward
 * acquires progression before its award marker. No provider
 * calls belong in operation; register them with afterCommit instead.
 * The quiz lock intentionally survives session reset/replacement.
 */
export async function mutateArena<T>(
  quizId: number,
  operation: (mutation: ArenaMutation) => Promise<T>,
  client: PrismaClient = prisma,
): Promise<T> {
  const effects: Array<() => Promise<unknown>> = [];
  let changed = false;
  const result = await client.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`arena-state:${quizId}`}))`;
    const state = await readArenaState(tx, quizId);
    const before = JSON.stringify(state);
    const mutation: ArenaMutation = { tx, state, now: Date.now(), afterCommit: (effect) => effects.push(effect) };
    const value = await operation(mutation);
    if (mutation.state?.players) mutation.state.players = mutation.state.participants;
    changed = JSON.stringify(mutation.state) !== before;
    if (changed) {
      if (mutation.state) {
        if (mutation.state.quizId !== quizId) throw new Error("Arena quiz identity cannot change");
        mutation.state.revision = (state?.revision ?? 0) + 1;
        await persistArenaState(tx, mutation.state);
      } else {
        await tx.setting.deleteMany({ where: { settingKey: arenaSettingKey(quizId) } });
      }
    }
    return value;
  }, { isolationLevel: "ReadCommitted", maxWait: 10_000, timeout: 30_000 });

  // Rejection/rollback never reaches this boundary. Provider failures cannot
  // undo a commit or turn a successful mutation into a misleading retry.
  if (changed && client === prisma) await invalidateArenaCaches(quizId);
  for (const effect of effects) {
    try { await effect(); } catch { console.warn("Arena post-commit delivery failed; reload authoritative state"); }
  }
  return result;
}

async function readArenaState(client: Prisma.TransactionClient, quizId: number): Promise<ArenaState | null> {
  const record = await client.setting.findUnique({
    where: { settingKey: arenaSettingKey(quizId) },
  });
  if (!record?.settingValue) return null;
  return JSON.parse(record.settingValue) as ArenaState;
}

async function persistArenaState(client: Prisma.TransactionClient, state: ArenaState): Promise<void> {
  await client.setting.upsert({
    where: { settingKey: arenaSettingKey(state.quizId) },
    update: { settingValue: JSON.stringify(state) },
    create: { settingKey: arenaSettingKey(state.quizId), settingValue: JSON.stringify(state) },
  });
}

export async function resolveArenaAttack(
  quizId: number,
  attackId: string,
  options: {
    now?: number;
    resolverStudentId?: string;
    expectedTargetStudentId?: string;
  } = {},
  client: PrismaClient = prisma,
): Promise<{ state: ArenaState | null; resolution: ArenaAttackResolution }> {
  return mutateArena(quizId, async ({ state }) => {
    if (!state) return { state: null, resolution: { code: "attack_not_found" } as ArenaAttackResolution };
    const resolution = resolvePendingAttackInState(state, attackId, options);
    return { state, resolution };
  }, client);
}

export async function deflectArenaAttack(
  quizId: number,
  attackId: string,
  options: { now?: number; defenderStudentId: string },
  client: PrismaClient = prisma,
): Promise<{ state: ArenaState | null; resolution: ArenaShieldResolution }> {
  return mutateArena(quizId, async ({ state }) => {
    if (!state) return { state: null, resolution: { code: "attack_not_found" } as ArenaShieldResolution };
    const resolution = deflectPendingAttackInState(state, attackId, options);
    return { state, resolution };
  }, client);
}

export function reconcileArenaAttacksInState(state: ArenaState, now: number): ArenaAttackResolution[] {
  const resolved: ArenaAttackResolution[] = [];
  for (const attack of Object.values(state.pendingAttacks || {})) {
    if (attack.status !== "pending" || attack.expiresAt >= now) continue;
    const resolution = resolvePendingAttackInState(state, attack.attackId, { now });
    if (resolution.code === "resolved") resolved.push(resolution);
  }
  return resolved;
}

export async function reconcileExpiredArenaAttacks(
  quizId: number,
  now = Date.now(),
  client: PrismaClient = prisma,
): Promise<{ state: ArenaState | null; resolved: ArenaAttackResolution[] }> {
  return mutateArena(quizId, async ({ state }) => {
    if (!state) return { state: null, resolved: [] as ArenaAttackResolution[] };

    const resolved = reconcileArenaAttacksInState(state, now);
    return { state, resolved };
  }, client);
}

export async function clearArenaState(quizId: number): Promise<void> {
  await mutateArena(quizId, async (mutation) => { mutation.state = null; });
}

/** Reads/reconciles authoritative state under the same mutation boundary. */
export async function getArenaState(quizId: number, client: PrismaClient = prisma): Promise<ArenaState | null> {
  return mutateArena(quizId, async ({ state, now }) => {
    if (state) reconcileArenaAttacksInState(state, now);
    return state;
  }, client);
}
