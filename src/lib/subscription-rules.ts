export const FREE_MANUAL_QUIZ_LIMIT = 5;

export interface TeacherEntitlementSummary {
  isSubscribed: boolean;
  planName: string;
  subscriptionEndsAt: Date | null;
  manualQuizCount: number;
  manualQuizLimit: number | null;
  manualQuizzesRemaining: number | null;
}

export type QuizCreationDecision =
  | { allowed: true }
  | { allowed: false; code: "SUBSCRIPTION_REQUIRED" | "FREE_QUIZ_LIMIT_REACHED"; message: string };

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
