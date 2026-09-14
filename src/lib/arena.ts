import crypto from "node:crypto";
import { getRedis } from "./redis.ts";

export const ARENA_MODES = ["battle_royale", "wave_sprint"] as const;
export const ARENA_POWER_IDS = ["meteor", "earthquake", "blizzard", "shield"] as const;
export const ARENA_ACTIONS = ["start", "wave", "airdrop", "end"] as const;

export type ArenaMode = (typeof ARENA_MODES)[number];
export type ArenaPowerId = (typeof ARENA_POWER_IDS)[number];
export type ArenaAction = (typeof ARENA_ACTIONS)[number];

export interface ArenaState {
  sessionId: string;
  quizId: number;
  teacherId: string;
  status: "active" | "ended";
  mode: ArenaMode;
  waveDuration: number;
  coinBounty: number;
  enabledPowers: ArenaPowerId[];
  currentWave: number;
  currentQuestionId: number;
  waveStartedAt: string;
  startedAt: string;
  endedAt: string | null;
}

const ARENA_TTL_SECONDS = 6 * 60 * 60;
const localArenaState = new Map<number, { value: ArenaState; expiresAt: number }>();
const validModes = new Set<string>(ARENA_MODES);
const validPowers = new Set<string>(ARENA_POWER_IDS);
const validActions = new Set<string>(ARENA_ACTIONS);

export function isArenaAction(value: unknown): value is ArenaAction {
  return typeof value === "string" && validActions.has(value);
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
  const record = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const mode = typeof record.mode === "string" && validModes.has(record.mode)
    ? record.mode as ArenaMode
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

export function createArenaState(params: {
  quizId: number;
  teacherId: string;
  currentQuestionId: number;
  config: ReturnType<typeof normalizeArenaConfig>;
}): ArenaState {
  const startedAt = new Date().toISOString();
  return {
    sessionId: crypto.randomUUID(),
    quizId: params.quizId,
    teacherId: params.teacherId,
    status: "active",
    ...params.config,
    currentWave: 0,
    currentQuestionId: params.currentQuestionId,
    waveStartedAt: startedAt,
    startedAt,
    endedAt: null,
  };
}

function arenaKey(quizId: number) {
  return `proctorshield:arena:${quizId}`;
}

export async function setArenaState(state: ArenaState) {
  const redis = getRedis();
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
