import { getQuizJoinDestination } from "./quiz-join.ts";

export interface RetakeEnrollment {
  quizId: number;
  attemptNumber: number;
  quizStatus: string | null;
  attemptMode?: string | null;
  quiz?: { quizMode?: string | null } | null;
}

export function getPendingRetakes(enrollments: RetakeEnrollment[]): Map<number, number> {
  return new Map(
    enrollments
      .filter((enrollment) => enrollment.quizStatus === "pending_retake")
      .map((enrollment) => [enrollment.quizId, enrollment.attemptNumber])
  );
}

export function getApprovedRetakeDestination(
  enrollments: RetakeEnrollment[],
  pendingRetakes: Map<number, number>
): string | null {
  for (const [quizId, attemptNumber] of pendingRetakes) {
    const approvedAttempt = enrollments.find((enrollment) =>
      enrollment.quizId === quizId &&
      enrollment.attemptNumber > attemptNumber &&
      ["enrolled", "in_progress"].includes(enrollment.quizStatus || "")
    );
    if (approvedAttempt) {
      const mode = approvedAttempt.attemptMode ?? approvedAttempt.quiz?.quizMode;
      return getQuizJoinDestination(quizId, mode === "arena" ? "arena" : "proctored");
    }
  }
  return null;
}
