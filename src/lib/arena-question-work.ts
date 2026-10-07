import type { Prisma } from "@prisma/client";
import { getAttemptQuestionOrder, shuffleArray } from "./quiz-question-order.ts";

export type ArenaRetryAnswer = {
  questionId: number;
  choiceId: number;
  isCorrect: boolean;
  answeredAt: string;
};
export type ArenaRetryState = {
  attemptId: string;
  sessionId: string;
  lastQuestionId: number | null;
  retryAnswers: Record<string, ArenaRetryAnswer>;
};
export type ArenaQuestionWork = {
  attemptId: string;
  sessionId: string;
  originalOrder: number[];
  originalAnswered: number;
  totalQuestions: number;
  correctCount: number;
  wrongCount: number;
  retryCorrectCount: number;
  retryWrongCount: number;
  pendingRetryIds: number[];
  skippedRetryIds: number[];
  retryAnswers: ArenaRetryAnswer[];
  nextWork: { questionId: number; kind: "initial" | "retry" } | null;
  isFinished: boolean;
};
type InitialAnswer = { questionId: number; answerText: string | null; isCorrect: boolean | null };
type WorkDatabase = Pick<Prisma.TransactionClient, "setting" | "answer">;
export const arenaRetryKey = (attemptId: string, sessionId: string) => `arena:retry:${sessionId}:${attemptId}`;

export function buildArenaQuestionWork(
  questions: readonly { id: number }[],
  initials: readonly InitialAnswer[],
  state: ArenaRetryState,
  closed = false,
): ArenaQuestionWork {
  const originalOrder = getAttemptQuestionOrder(questions, state.attemptId).map(q => q.id);
  const validIds = new Set(originalOrder);
  const answers = new Map(initials
    .filter(a => validIds.has(a.questionId) && typeof a.isCorrect === "boolean")
    .map(a => [a.questionId, a]));
  const wrong = originalOrder.filter(id => answers.get(id)?.isCorrect === false);
  const retries = Object.values(state.retryAnswers);
  if (retries.some(a => !wrong.includes(a.questionId))) {
    throw new Error("Retry has no canonical initial wrong answer");
  }
  // Filter completed retries AFTER shuffling, preserving the remaining permutation.
  const pendingRetryIds = shuffleArray(wrong, `${state.attemptId}:retry`).filter(id => !state.retryAnswers[id]);
  const nextInitial = originalOrder.find(id => !answers.has(id));
  // Complete the original permutation first. Choose a different missed question
  // when the last original was wrong, so a retry can never immediately repeat it.
  const last = state.lastQuestionId ?? originalOrder.filter(id => answers.has(id)).at(-1) ?? null;
  const nextRetry = pendingRetryIds.find(id => id !== last);
  // With no intervening work available, skip the final miss rather than repeating
  // it immediately or leaving the student waiting forever (also covers one question).
  const skippedRetryIds = nextInitial === undefined && nextRetry === undefined ? [...pendingRetryIds] : [];
  const nextWork = closed ? null
    : nextInitial !== undefined ? { questionId: nextInitial, kind: "initial" as const }
    : nextRetry !== undefined ? { questionId: nextRetry, kind: "retry" as const } : null;
  return {
    attemptId: state.attemptId,
    sessionId: state.sessionId,
    originalOrder,
    originalAnswered: answers.size,
    totalQuestions: originalOrder.length,
    correctCount: [...answers.values()].filter(a => a.isCorrect).length,
    wrongCount: wrong.length,
    retryCorrectCount: retries.filter(a => a.isCorrect).length,
    retryWrongCount: retries.filter(a => !a.isCorrect).length,
    pendingRetryIds: closed || skippedRetryIds.length ? [] : pendingRetryIds,
    skippedRetryIds,
    retryAnswers: retries,
    nextWork,
    isFinished: closed || (answers.size === originalOrder.length && nextWork === null),
  };
}

export async function readArenaQuestionWork(
  db: WorkDatabase,
  attemptId: string,
  sessionId: string,
  questions: readonly { id: number }[],
  closed = false,
  timing?: { matchEndsAt?: string | null; now?: number },
) {
  // Snapshot the server deadline before the reads. Rendering consumes the
  // resulting work; it does not read a clock or advance gameplay state.
  const closedAtRead = closed || Boolean(timing?.matchEndsAt
    && (timing.now ?? Date.now()) >= Date.parse(timing.matchEndsAt));
  const [record, initials] = await Promise.all([
    db.setting.findUnique({ where: { settingKey: arenaRetryKey(attemptId, sessionId) } }),
    db.answer.findMany({
      where: { studentQuizId: attemptId, isCorrect: { not: null } },
      select: { questionId: true, answerText: true, isCorrect: true },
    }),
  ]);
  let state: ArenaRetryState = { attemptId, sessionId, lastQuestionId: null, retryAnswers: {} };
  if (record) {
    state = JSON.parse(record.settingValue ?? "");
    if (!state || state.attemptId !== attemptId || state.sessionId !== sessionId
      || !state.retryAnswers || typeof state.retryAnswers !== "object" || Array.isArray(state.retryAnswers)
      || (state.lastQuestionId !== null && !Number.isInteger(state.lastQuestionId))
      || Object.entries(state.retryAnswers).some(([key, a]) => !a || String(a.questionId) !== key
        || !Number.isInteger(a.questionId) || a.questionId <= 0 || !Number.isInteger(a.choiceId) || a.choiceId <= 0
        || typeof a.isCorrect !== "boolean" || !Number.isFinite(Date.parse(a.answeredAt)))) {
      throw new Error("Invalid persisted Arena retry state");
    }
  }
  return { state, work: buildArenaQuestionWork(questions, initials, state, closedAtRead) };
}

export async function saveArenaRetryState(db: Pick<WorkDatabase, "setting">, state: ArenaRetryState) {
  const settingKey = arenaRetryKey(state.attemptId, state.sessionId);
  const settingValue = JSON.stringify(state);
  await db.setting.upsert({ where: { settingKey }, create: { settingKey, settingValue }, update: { settingValue } });
}
