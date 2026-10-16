import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import {
  FREE_MANUAL_QUIZ_LIMIT,
  getFreeQuizQuotaWindow,
  getStudentLimitPerQuiz,
  type TeacherEntitlementSummary,
} from "@/lib/subscription-rules";

type EntitlementClient = Pick<
  Prisma.TransactionClient,
  "userSubscription" | "quiz" | "activityLog"
>;

export async function hasActiveProSubscription(
  userId: string,
  db: Pick<Prisma.TransactionClient, "userSubscription"> = prisma,
  now = new Date(),
) {
  const subscription = await db.userSubscription.findFirst({
    where: {
      userId,
      subscriptionStatus: "active",
      endDate: { gt: now },
      plan: { yearlyPrice: { gt: 0 } },
    },
    select: { id: true },
  });
  return Boolean(subscription);
}

export async function getTeacherEntitlements(
  userId: string,
  db: EntitlementClient = prisma,
  now = new Date(),
): Promise<TeacherEntitlementSummary> {
  const { start, end } = getFreeQuizQuotaWindow(now);
  const [subscription, currentManualQuizCount, recordedManualQuizCount] = await Promise.all([
    db.userSubscription.findFirst({
      where: {
        userId,
        subscriptionStatus: "active",
        endDate: { gt: now },
        plan: { yearlyPrice: { gt: 0 } },
      },
      orderBy: { endDate: "desc" },
      select: {
        endDate: true,
        plan: { select: { planName: true } },
      },
    }),
    db.quiz.count({
      where: { teacherId: userId, isAiGenerated: false, createdAt: { gte: start, lt: end } },
    }),
    db.activityLog.count({
      where: {
        userId,
        createdAt: { gte: start, lt: end },
        OR: [
          { activity: { startsWith: "Created quiz:" } },
          { activity: { startsWith: "Created manual quiz:" } },
        ],
      },
    }),
  ]);

  const isSubscribed = Boolean(subscription);
  // Count this calendar month only. Activity records retain usage after deletion;
  // max() also covers legacy quizzes created before quota logging.
  const manualQuizCount = Math.max(currentManualQuizCount, recordedManualQuizCount);
  return {
    isSubscribed,
    planName: subscription?.plan.planName ?? "Free Tier",
    subscriptionEndsAt: subscription?.endDate ?? null,
    manualQuizCount,
    manualQuizLimit: isSubscribed ? null : FREE_MANUAL_QUIZ_LIMIT,
    manualQuizzesRemaining: isSubscribed
      ? null
      : Math.max(0, FREE_MANUAL_QUIZ_LIMIT - manualQuizCount),
    studentLimitPerQuiz: getStudentLimitPerQuiz(isSubscribed),
  };
}
