import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import type { PaidCheckout } from "@/lib/paymongo-events";

export type PaidCheckoutActivation = "activated" | "already_processed" | "invalid";

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export async function activatePaidCheckout(
  paid: PaidCheckout,
  event: { id: string; type: string; source: string },
): Promise<PaidCheckoutActivation> {
  if (paid.paymentStatus !== "paid") return "invalid";

  const [user, plan] = await Promise.all([
    prisma.user.findFirst({ where: { id: paid.userId, role: { roleName: "teacher" } } }),
    prisma.subscriptionPlan.findUnique({ where: { id: paid.planId } }),
  ]);
  if (!user || !plan || plan.yearlyPrice === null) return "invalid";

  const expectedCentavos = Math.round(Number(plan.yearlyPrice) * 100);
  if (paid.amountCentavos !== expectedCentavos) return "invalid";

  try {
    await prisma.$transaction(async (tx) => {
      await tx.webhookEvent.create({
        data: { provider: "paymongo", eventId: event.id, eventType: event.type },
      });
      const now = new Date();
      const durationDays = plan.durationDays ?? 30;
      const existing = await tx.userSubscription.findUnique({
        where: { userId_planId: { userId: paid.userId, planId: paid.planId } },
      });
      const baseDate = existing && existing.endDate > now ? existing.endDate : now;
      const endDate = new Date(baseDate.getTime() + durationDays * 86_400_000);
      const subscription = await tx.userSubscription.upsert({
        where: { userId_planId: { userId: paid.userId, planId: paid.planId } },
        update: { endDate, paymentStatus: "paid", subscriptionStatus: "active" },
        create: {
          userId: paid.userId,
          planId: paid.planId,
          startDate: now,
          endDate,
          paymentStatus: "paid",
          subscriptionStatus: "active",
        },
      });
      await tx.payment.create({
        data: {
          subscriptionId: subscription.id,
          amount: paid.amountCentavos / 100,
          paymentMethod: paid.paymentMethod,
          paymentStatus: "paid",
          transactionReference: paid.reference,
          providerPaymentId: paid.providerPaymentId,
          paidAt: now,
        },
      });
      await tx.activityLog.create({
        data: {
          userId: paid.userId,
          activity: `Subscribed to ${plan.planName} for ${durationDays} days via ${paid.paymentMethod}`,
          ipAddress: event.source,
        },
      });
    });
    return "activated";
  } catch (error) {
    if (isUniqueConstraintError(error)) return "already_processed";
    throw error;
  }
}
