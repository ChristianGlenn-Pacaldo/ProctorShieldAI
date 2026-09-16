import crypto from "node:crypto";
import { getRedis } from "./redis.ts";

export const ARENA_MODES = ["battle_royale", "wave_sprint"] as const;
export const ARENA_POWER_IDS = ["meteor", "earthquake", "blizzard", "shield"] as const;
export const ARENA_ACTIONS = ["start", "wave", "airdrop", "end", "reset"] as const;

export type ArenaMode = (typeof ARENA_MODES)[number];
export type ArenaPowerId = (typeof ARENA_POWER_IDS)[number];
export type ArenaAction = (typeof ARENA_ACTIONS)[number];

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

export interface ArenaParticipant {
  studentId: string;
  studentName: string;
  avatar: string;
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
  sessionId: string;
  quizId: number;
  teacherId: string;
  status: "active" | "ended";
  mode: ArenaMode;
  matchDuration: number; // overall match duration in seconds (e.g. 300, 600, 900)
  matchEndsAt?: string;
  coinBounty: number;
  enabledPowers: ArenaPowerId[];
  totalQuestions: number;
  startedAt: string;
  endedAt: string | null;
  participants: Record<string, ArenaParticipant>;
  usedPowers: Record<string, Record<string, boolean>>; // studentId -> powerId -> boolean
  pendingAttacks?: Record<string, PendingAttack>;
  // Deprecated wave fields preserved for compatibility during transition
  currentWave?: number;
  currentQuestionId?: number;
  waveDuration?: number;
  waveStartedAt?: string;
  waveEndsAt?: string;
  players?: Record<string, ArenaParticipant>;
}

const ARENA_TTL_SECONDS = 6 * 60 * 60;
const localArenaState = new Map<number, { value: ArenaState; expiresAt: number }>();
const validModes = new Set<string>(ARENA_MODES);
const validPowers = new Set<string>(ARENA_POWER_IDS);
const validActions = new Set<string>(ARENA_ACTIONS);

export function isArenaAction(value: unknown): value is ArenaAction {
  return typeof value === "string" && (validActions.has(value) || value === "wave");
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
  "mode" | "waveDuration" | "coinBounty" | "enabledPowers"
> {
  const record = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const mode =
    typeof record.mode === "string" && validModes.has(record.mode)
      ? (record.mode as ArenaMode)
      : "battle_royale";
  const requestedPowers = Array.isArray(record.enabledPowers) ? record.enabledPowers : [];
  const enabledPowers = Array.from(new Set(requestedPowers.filter(isArenaPowerId)));

  return {
    mode,
    waveDuration: allowedNumber(record.waveDuration, [20, 30, 45], 30),
    coinBounty: allowedNumber(record.coinBounty, [250, 500, 1000], 500),
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

export function createArenaState(params: {
  quizId: number;
  teacherId: string;
  totalQuestions?: number;
  currentQuestionId?: number;
  config?: Partial<ReturnType<typeof normalizeArenaConfig>> | Record<string, unknown>;
}): ArenaState {
  const config = normalizeArenaConfig(params.config);
  const startedAt = new Date().toISOString();
  const rawRecord = params.config && typeof params.config === "object" ? (params.config as Record<string, unknown>) : {};
  const rawMatchDuration = rawRecord.matchDuration || rawRecord.duration;
  const matchDuration = typeof rawMatchDuration === "number" && rawMatchDuration > 0
    ? rawMatchDuration
    : (config.waveDuration ? config.waveDuration * 10 : 600);
  const matchEndsAt = new Date(Date.now() + matchDuration * 1000).toISOString();

  const state: ArenaState = {
    sessionId: crypto.randomUUID(),
    quizId: params.quizId,
    teacherId: params.teacherId,
    status: "active",
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
  player: { studentId: string; studentName: string; avatar?: string; isAi?: boolean },
): ArenaParticipant {
  if (!state.participants) state.participants = {};
  if (!state.players) state.players = state.participants;
  const existing = state.participants[player.studentId];
  if (existing) {
    if (player.studentName && !existing.studentName) existing.studentName = player.studentName;
    if (player.avatar && !existing.avatar) existing.avatar = player.avatar;
    return existing;
  }
  const created: ArenaParticipant = {
    studentId: player.studentId,
    studentName: player.studentName || "Fighter",
    avatar: player.avatar || "🎓",
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

export async function setArenaState(state: ArenaState) {
  const redis = getRedis();
  // Preserve ended arena state for reconciliation queries instead of deleting immediately.
  if (redis) {
    try {
      await redis.set(arenaKey(state.quizId), JSON.stringify(state), "EX", ARENA_TTL_SECONDS);
    } catch (error) {
      console.warn("Arena Redis write failed; using the single-process fallback:", error);
    }
  }
  localArenaState.set(state.quizId, {
    value: state,
    expiresAt: Date.now() + ARENA_TTL_SECONDS * 1000,
  });
}

export async function clearArenaState(quizId: number) {
  localArenaState.delete(quizId);
  const redis = getRedis();
  if (redis) {
    try {
      await redis.del(arenaKey(quizId));
    } catch (error) {
      console.warn("Arena Redis delete failed:", error);
    }
  }
}

export async function getArenaState(quizId: number): Promise<ArenaState | null> {
  const redis = getRedis();
  if (redis) {
    try {
      const value = await redis.get(arenaKey(quizId));
      if (value) {
        try {
          return JSON.parse(value) as ArenaState;
        } catch {
          await redis.del(arenaKey(quizId));
        }
      }
    } catch (error) {
      console.warn("Arena Redis read failed; using the single-process fallback:", error);
    }
  }

  const local = localArenaState.get(quizId);
  if (!local || local.expiresAt <= Date.now()) {
    localArenaState.delete(quizId);
    return null;
  }
  return local.value;
}
