import type { QuizMode } from "./quiz-mode.ts";

export type QuizJoinState = "joinable" | "review" | "closed";

export interface QuizJoinEligibility {
  eligible: boolean;
  reviewOnly: boolean;
  state: QuizJoinState;
  message: string;
}

export function getQuizJoinDestination(quizId: number, quizMode: QuizMode): string {
  if (!Number.isInteger(quizId) || quizId <= 0) {
    throw new Error("A valid quiz ID is required.");
  }
  return quizMode === "arena" ? `/arena/${quizId}` : `/quiz/${quizId}`;
}

export function getQuizJoinEligibility(input: {
  quizMode: QuizMode;
  quizStatus: string;
  hasEnrollment: boolean;
}): QuizJoinEligibility {
  if (input.quizStatus !== "ended") {
    return {
      eligible: true,
      reviewOnly: false,
      state: "joinable",
      message: input.quizMode === "arena" ? "Power Arena is ready to join." : "Quiz is ready to join.",
    };
  }

  if (input.quizMode === "arena" && input.hasEnrollment) {
    return {
      eligible: true,
      reviewOnly: true,
      state: "review",
      message: "This Power Arena has ended. Your final results are available for review.",
    };
  }

  return {
    eligible: false,
    reviewOnly: false,
    state: "closed",
    message: input.quizMode === "arena"
      ? "This Power Arena has already ended and cannot be joined again."
      : "This quiz has already ended and is no longer accepting submissions.",
  };
}
