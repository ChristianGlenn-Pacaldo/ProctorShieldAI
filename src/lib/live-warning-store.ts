import { getRedis, isRedisReady } from "./redis.ts";

export const DEFAULT_TEACHER_WARNING = "Your teacher has sent a warning. Please keep your face visible, stay on the exam screen, and follow the quiz rules.";

export type LiveWarningRecord = {
  id: string;
  studentId: string;
  teacherId: string;
  quizId: number;
  message: string;
  createdAt: string;
};

const WARNING_TTL_MS = 10 * 60_000;
const globalWarnings = globalThis as typeof globalThis & {
  __proctorShieldLiveWarnings?: Map<string, LiveWarningRecord>;
};
const localWarnings = globalWarnings.__proctorShieldLiveWarnings ?? new Map<string, LiveWarningRecord>();
globalWarnings.__proctorShieldLiveWarnings = localWarnings;

function warningKey(studentId: string, quizId: number) {
  return `proctorshield:live-warning:${studentId}:${quizId}`;
}

export function normalizeTeacherWarningMessage(value: unknown) {
  if (typeof value !== "string") return DEFAULT_TEACHER_WARNING;
  const normalized = value.replace(/\s+/g, " ").trim().slice(0, 240);
  return normalized || DEFAULT_TEACHER_WARNING;
}

export async function saveLiveWarning(record: LiveWarningRecord) {
  const key = warningKey(record.studentId, record.quizId);
  localWarnings.set(key, record);

  const redis = getRedis();
  if (isRedisReady(redis)) {
    try {
      await redis!.set(key, JSON.stringify(record), "PX", WARNING_TTL_MS);
    } catch {
      // Redis offline; local cache remains authoritative
    }
  }
}

export async function getLatestLiveWarning(studentId: string, quizId: number) {
  const key = warningKey(studentId, quizId);
  const redis = getRedis();
  if (isRedisReady(redis)) {
    try {
      const value = await redis!.get(key);
      if (value) return JSON.parse(value) as LiveWarningRecord;
    } catch {
      // Fallback to local cache below
    }
  }

  const record = localWarnings.get(key) ?? null;
  if (!record) return null;
  if (Date.now() - Date.parse(record.createdAt) > WARNING_TTL_MS) {
    localWarnings.delete(key);
    return null;
  }
  return record;
}
