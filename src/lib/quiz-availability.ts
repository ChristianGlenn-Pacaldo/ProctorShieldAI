export const DELETED_QUIZ_STATUS = "deleted" as const;
export const UNAVAILABLE_QUIZ_STATUSES = [DELETED_QUIZ_STATUS, "archived", "unavailable"] as const;

export function isQuizAvailable(quizStatus: unknown): boolean {
  return typeof quizStatus === "string"
    && !UNAVAILABLE_QUIZ_STATUSES.includes(quizStatus as (typeof UNAVAILABLE_QUIZ_STATUSES)[number]);
}

export function quizNotAvailableResponse() {
  return {
    error: "This quiz is no longer available.",
    code: "QUIZ_NOT_AVAILABLE",
  };
}
