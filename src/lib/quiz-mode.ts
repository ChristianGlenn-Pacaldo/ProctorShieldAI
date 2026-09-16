export const QUIZ_MODES = ["proctored", "arena"] as const;
export type QuizMode = (typeof QUIZ_MODES)[number];

export class InvalidQuizModeError extends Error {
  code = "INVALID_QUIZ_MODE";

  constructor(message = "Invalid quiz mode.") {
    super(message);
    this.name = "InvalidQuizModeError";
  }
}

export function isQuizMode(value: unknown): value is QuizMode {
  return typeof value === "string" && (QUIZ_MODES as readonly string[]).includes(value);
}

export function parseQuizMode(value: unknown): QuizMode {
  if (value === null || value === undefined) {
    return "proctored";
  }
  if (isQuizMode(value)) {
    return value;
  }
  throw new InvalidQuizModeError();
}

export function isArenaQuiz(quiz: { quizMode?: string | null } | null | undefined): boolean {
  return quiz?.quizMode === "arena";
}

export function isProctoredQuiz(quiz: { quizMode?: string | null } | null | undefined): boolean {
  return quiz?.quizMode === "proctored" || quiz?.quizMode === null || quiz?.quizMode === undefined;
}

/**
 * HISTORICAL CLASSIFICATION INVARIANT (Rule for later phases):
 * 
 * - StudentQuiz.attemptMode is the authoritative mode of a historical attempt.
 * - Quiz.quizMode represents the current configuration of the quiz.
 * 
 * Reports, historical results, and completed attempt evaluation must prefer attemptMode
 * when determining how a past attempt should be classified.
 */

export interface QuizModeTransitionParams {
  currentMode: QuizMode;
  targetMode: QuizMode;
  attemptsCount: number;
  quizStatus: string;
}

export type QuizModeTransitionDecision =
  | { allowed: true }
  | {
      allowed: false;
      code: "QUIZ_MODE_CHANGE_NOT_ALLOWED";
      error: string;
    };

export function canChangeQuizMode(params: QuizModeTransitionParams): QuizModeTransitionDecision {
  const { currentMode, targetMode, attemptsCount, quizStatus } = params;

  // Sending the same mode as currently stored is always allowed as a no-op
  if (currentMode === targetMode) {
    return { allowed: true };
  }

  // A quiz mode change is allowed ONLY when:
  // - the quiz has zero StudentQuiz attempts
  //   AND
  // - the quiz is still in a safe draft/unstarted state.
  if (attemptsCount > 0 || quizStatus !== "draft") {
    return {
      allowed: false,
      code: "QUIZ_MODE_CHANGE_NOT_ALLOWED",
      error: "Quiz mode cannot be changed after students have joined or attempted the quiz.",
    };
  }

  return { allowed: true };
}
