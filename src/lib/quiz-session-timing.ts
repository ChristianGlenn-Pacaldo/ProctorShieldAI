import type { Prisma } from "@prisma/client";

type SessionDatabase = Pick<Prisma.TransactionClient, "setting" | "studentQuiz">;
type TimedQuiz = { id: number; duration: number | null; quizStatus: string | null };
export type QuizSessionTiming = { sessionId: string; startedAt: string; endsAt: string };

// A monitored quiz has one start lifecycle; ended quizzes cannot be restarted.
// Attempt IDs identify academic history, not a new timed session.
export const proctoredSessionKey = (quizId: number) => `proctored:session:${quizId}`;

export function createProctoredSession(quiz: Pick<TimedQuiz, "id" | "duration">, startedAt: Date): QuizSessionTiming {
  const minutes = quiz.duration ?? 60;
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 480) throw new Error("Invalid saved quiz duration");
  return { sessionId: `proctored:${quiz.id}`, startedAt: startedAt.toISOString(), endsAt: new Date(startedAt.getTime() + minutes * 60_000).toISOString() };
}

function parseTiming(value: unknown): QuizSessionTiming {
  const record = value as Partial<QuizSessionTiming> | null;
  if (!record || typeof record.sessionId !== "string" || typeof record.startedAt !== "string" || typeof record.endsAt !== "string"
    || !Number.isFinite(Date.parse(record.startedAt)) || !Number.isFinite(Date.parse(record.endsAt)) || Date.parse(record.endsAt) <= Date.parse(record.startedAt)) {
    throw new Error("Invalid persisted session deadline");
  }
  return record as QuizSessionTiming;
}

export async function readProctoredSession(db: SessionDatabase, quiz: TimedQuiz): Promise<QuizSessionTiming | null> {
  if (!["in_progress", "ended"].includes(quiz.quizStatus ?? "")) return null;
  const saved = await db.setting.findUnique({ where: { settingKey: proctoredSessionKey(quiz.id) } });
  if (saved) {
    const timing = parseTiming(JSON.parse(saved.settingValue ?? ""));
    if (timing.sessionId !== `proctored:${quiz.id}`) throw new Error("Session identity mismatch");
    return timing;
  }
  // Existing deployed sessions have no clock record. Preserve the earliest
  // retained attempt's clock, including completed/auto-submitted attempts.
  const first = await db.studentQuiz.findFirst({ where: { quizId: quiz.id, attemptMode: "proctored", startTime: { not: null } }, orderBy: { startTime: "asc" }, select: { startTime: true } });
  return first?.startTime ? createProctoredSession(quiz, first.startTime) : null;
}

export async function readArenaSession(db: Pick<SessionDatabase, "setting">, quizId: number): Promise<QuizSessionTiming | null> {
  const saved = await db.setting.findUnique({ where: { settingKey: `arena:state:${quizId}` } });
  if (!saved?.settingValue) return null;
  const arena = JSON.parse(saved.settingValue);
  if (arena.status !== "active") return null;
  return parseTiming({ sessionId: arena.sessionId, startedAt: arena.startedAt, endsAt: arena.matchEndsAt });
}

export function sessionTimingPayload(timing: QuizSessionTiming, quizStatus: string | null, now = Date.now()) {
  return { sessionId: timing.sessionId, sessionStartedAt: timing.startedAt, sessionEndsAt: timing.endsAt, serverTime: now,
    remainingSeconds: quizStatus === "ended" ? 0 : Math.max(0, Math.ceil((Date.parse(timing.endsAt) - now) / 1000)) };
}
