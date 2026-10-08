export interface StudentResultRecord {
  attemptMode?: string | null;
  quizStatus?: string | null;
  endTime?: Date | string | null;
  score?: number | string | null;
  integrityInvalidated?: boolean;
  _count?: { violations: number };
}

// Historical attempt mode is authoritative; the quiz's current mode may change.
export function studentResultState(record: StudentResultRecord) {
  const isArena = record.attemptMode === "arena";
  const isCompleted = record.endTime != null
    && ["completed", "pending_retake"].includes(record.quizStatus || "");
  const integrityInvalidated = !isArena && (record.integrityInvalidated === true
    || (record._count?.violations ?? 0) >= 3);
  return { isArena, isCompleted, integrityInvalidated };
}

export function averageExamScore(records: readonly StudentResultRecord[]) {
  const scores = records.flatMap((record) => {
    const state = studentResultState(record);
    if (!state.isCompleted || state.isArena || state.integrityInvalidated || record.score == null) return [];
    const score = Number(record.score);
    return Number.isFinite(score) ? [score] : [];
  });
  // Exam scores were already normalized by weighted grading on submission.
  // Count completed attempts, including retakes, as the Results page does.
  return scores.length ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length) : 0;
}
