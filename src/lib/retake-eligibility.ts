type RetakeAttempt = {
  id: string;
  quizStatus: string | null;
  endTime: Date | string | null;
  quiz: { allowRetake: boolean };
};

// Shared by the request endpoint and Student payloads. Keep rejection order intact.
export function getRetakeRequestError(attempt: RetakeAttempt, latestAttemptId: string | undefined) {
  if (latestAttemptId !== attempt.id) {
    return { error: "Only the latest attempt can be retaken", status: 409 };
  }
  if (!attempt.quiz.allowRetake) {
    return { error: "Retakes are not enabled for this quiz", status: 403 };
  }
  if (attempt.quizStatus === "pending_retake") {
    return { error: "Retake already requested", status: 400 };
  }
  if (attempt.quizStatus !== "completed" || !attempt.endTime) {
    return { error: "Only a completed attempt can be retaken", status: 409 };
  }
  return null;
}

// Call only with all attempts for the authenticated Student (no history pagination).
export function withRetakeEligibility<T extends RetakeAttempt & { quizId: number; attemptNumber: number }>(attempts: T[]) {
  const latestByQuiz = new Map<number, T>();
  for (const attempt of attempts) {
    const latest = latestByQuiz.get(attempt.quizId);
    if (!latest || attempt.attemptNumber > latest.attemptNumber) latestByQuiz.set(attempt.quizId, attempt);
  }
  return attempts.map((attempt) => ({
    ...attempt,
    canRequestRetake: getRetakeRequestError(attempt, latestByQuiz.get(attempt.quizId)?.id) === null,
  }));
}
