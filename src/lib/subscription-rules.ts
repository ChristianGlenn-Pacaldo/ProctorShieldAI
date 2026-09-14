export const FREE_MANUAL_QUIZ_LIMIT = 5;
export const FREE_STUDENT_LIMIT_PER_QUIZ = 20;
export const PRO_STUDENT_LIMIT_PER_QUIZ = 100;
export const PRO_MONTHLY_PRICE_PHP = 500;
export const PRO_SUBSCRIPTION_DURATION_DAYS = 30;

export interface TeacherEntitlementSummary {
  isSubscribed: boolean;
  planName: string;
  subscriptionEndsAt: Date | null;
  manualQuizCount: number;
  manualQuizLimit: number | null;
  manualQuizzesRemaining: number | null;
  studentLimitPerQuiz: number;
}

export type QuizCreationDecision =
  | { allowed: true }
  | { allowed: false; code: "SUBSCRIPTION_REQUIRED" | "FREE_QUIZ_LIMIT_REACHED"; message: string };

export type QuizCapacityDecision =
  | { allowed: true; limit: number; remaining: number }
  | { allowed: false; code: "QUIZ_CAPACITY_REACHED"; limit: number; remaining: 0; message: string };

export function getStudentLimitPerQuiz(isSubscribed: boolean) {
  return isSubscribed ? PRO_STUDENT_LIMIT_PER_QUIZ : FREE_STUDENT_LIMIT_PER_QUIZ;
}

export function getQuizCapacityDecision(
  isSubscribed: boolean,
  enrolledStudentCount: number,
): QuizCapacityDecision {
  const limit = getStudentLimitPerQuiz(isSubscribed);
  const remaining = Math.max(0, limit - enrolledStudentCount);

  if (remaining === 0) {
    return {
      allowed: false,
      code: "QUIZ_CAPACITY_REACHED",
      limit,
      remaining: 0,
      message: `This quiz is full (${limit} students maximum for the teacher's ${isSubscribed ? "Pro" : "Free"} plan).`,
    };
  }

  return { allowed: true, limit, remaining };
}

export function getQuizCreationDecision(
  entitlements: TeacherEntitlementSummary,
  isAiGenerated: boolean,
): QuizCreationDecision {
  if (isAiGenerated && !entitlements.isSubscribed) {
    return {
      allowed: false,
      code: "SUBSCRIPTION_REQUIRED",
      message: "AI quiz creation requires an active Pro subscription.",
    };
  }

  if (
    !isAiGenerated &&
    !entitlements.isSubscribed &&
    entitlements.manualQuizCount >= FREE_MANUAL_QUIZ_LIMIT
  ) {
    return {
      allowed: false,
      code: "FREE_QUIZ_LIMIT_REACHED",
      message: `Free teachers can create up to ${FREE_MANUAL_QUIZ_LIMIT} manual quizzes. Upgrade to Pro for unlimited quizzes.`,
    };
  }

  return { allowed: true };
}
