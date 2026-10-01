import type { Prisma, PrismaClient } from "@prisma/client";
import prisma from "@/lib/prisma";
import type { PaidCheckout, RefundedPayment } from "@/lib/paymongo-events";
import { entitlementDay, rebuildEntitlement } from "@/lib/paymongo-entitlement";

export type PaidCheckoutActivation = "activated" | "already_processed" | "invalid";

type BillingEvent = { id: string; type: string; source: string };
const transactionOptions = { isolationLevel: "ReadCommitted" as const, maxWait: 10_000, timeout: 20_000 };

// Every provider mutation takes payment identity first, then Teacher identity.
// The Teacher lock also protects first-time creation and spans all their plans.
// Refunds look up ownership after the payment lock, then re-read entitlement
// only after taking the Teacher lock. Neither boundary calls a provider.
async function lockPayment(tx: Prisma.TransactionClient, paymentId: string) {
  // Bound PostgreSQL lock waits as well as Prisma's transaction lifetime.
  await tx.$executeRaw`SET LOCAL lock_timeout = '10s'`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(17001, hashtext(${paymentId}))`;
}

async function lockTeacher(tx: Prisma.TransactionClient, userId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(17002, hashtext(${userId}))`;
}

async function eventReceipt(tx: Prisma.TransactionClient, event: BillingEvent) {
  const receipt = await tx.webhookEvent.findUnique({ where: { eventId: event.id } });
  if (receipt && (receipt.provider !== "paymongo" || receipt.eventType !== event.type)) {
    throw new Error("PayMongo event identity conflicts with an existing receipt");
  }
  return receipt;
}

async function recordEvent(tx: Prisma.TransactionClient, event: BillingEvent) {
  await tx.webhookEvent.create({
    data: { provider: "paymongo", eventId: event.id, eventType: event.type },
  });
}

async function subscriptionExpiry(tx: Prisma.TransactionClient, subscription: {
  id: string; grantBaselineAt: Date | null; grantBaselineEndDate: Date | null;
}, now: Date) {
  if (!subscription.grantBaselineAt || !subscription.grantBaselineEndDate) {
    throw new Error("PayMongo subscription requires verified grant accounting backfill");
  }
  const payments = await tx.payment.findMany({
    where: { subscriptionId: subscription.id, grantDurationDays: { not: null } },
    select: { id: true, providerPaymentId: true, paidAt: true, grantDurationDays: true, grantRevokedOn: true },
  });
  return rebuildEntitlement(subscription.grantBaselineAt, subscription.grantBaselineEndDate, payments.map(payment => {
    if (!payment.paidAt || payment.grantDurationDays === null) throw new Error("Incomplete PayMongo grant snapshot");
    return { key: payment.providerPaymentId ?? payment.id, paidAt: payment.paidAt,
      durationDays: payment.grantDurationDays, revokedOn: payment.grantRevokedOn };
  }), now);
}

async function validateExpiry(tx: Prisma.TransactionClient, subscription: {
  id: string; endDate: Date; grantBaselineAt: Date | null; grantBaselineEndDate: Date | null;
}, now: Date) {
  const expected = await subscriptionExpiry(tx, subscription, now);
  if (expected.getTime() !== Math.max(entitlementDay(now).getTime(), subscription.endDate.getTime())) {
    throw new Error("PayMongo entitlement changed outside grant accounting; reviewed reconciliation required");
  }
}

export async function activatePaidCheckout(
  paid: PaidCheckout,
  event: BillingEvent,
  client: PrismaClient = prisma,
): Promise<PaidCheckoutActivation> {
  if (paid.paymentStatus !== "paid") return "invalid";

  return client.$transaction(async (tx) => {
    await lockPayment(tx, paid.providerPaymentId);
    await lockTeacher(tx, paid.userId);
    const [user, plan] = await Promise.all([
      tx.user.findFirst({ where: { id: paid.userId, role: { roleName: "teacher" } } }),
      tx.subscriptionPlan.findUnique({ where: { id: paid.planId } }),
    ]);
    if (!user || !plan || plan.yearlyPrice === null) return "invalid";

    const expectedCentavos = Math.round(Number(plan.yearlyPrice) * 100);
    if (paid.amountCentavos !== expectedCentavos) return "invalid";

    const receipt = await eventReceipt(tx, event);
    const payment = await tx.payment.findUnique({
      where: { providerPaymentId: paid.providerPaymentId },
      include: { subscription: true },
    });
    if (payment) {
      if (payment.subscription.userId !== paid.userId || payment.subscription.planId !== paid.planId
        || Math.round(Number(payment.amount) * 100) !== paid.amountCentavos) {
        throw new Error("PayMongo payment identity conflicts with its persisted purchase");
      }
      if (!receipt) await recordEvent(tx, event);
      return "already_processed";
    }
    // An event receipt alone cannot prove this different payment was applied.
    if (receipt) throw new Error("PayMongo event receipt has no matching payment");
    await recordEvent(tx, event);
    const now = new Date();
    const durationDays = plan.durationDays ?? 30;
    const existing = await tx.userSubscription.findUnique({
      where: { userId_planId: { userId: paid.userId, planId: paid.planId } },
    });
    if (existing?.grantBaselineAt) await validateExpiry(tx, existing, now);
    const baseDate = existing && existing.endDate > now ? existing.endDate : now;
    const endDate = new Date(baseDate.getTime() + durationDays * 86_400_000);
    const subscription = await tx.userSubscription.upsert({
      where: { userId_planId: { userId: paid.userId, planId: paid.planId } },
      update: { endDate, paymentStatus: "paid", subscriptionStatus: "active",
        grantBaselineAt: existing?.grantBaselineAt ?? entitlementDay(now),
        grantBaselineEndDate: existing?.grantBaselineEndDate ?? existing?.endDate ?? entitlementDay(now) },
      create: {
        userId: paid.userId,
        planId: paid.planId,
        startDate: now,
        endDate,
        paymentStatus: "paid",
        subscriptionStatus: "active",
        grantBaselineAt: entitlementDay(now),
        grantBaselineEndDate: entitlementDay(now),
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
        grantDurationDays: durationDays,
      },
    });
    await tx.userSubscription.update({
      where: { id: subscription.id },
      data: { endDate: await subscriptionExpiry(tx, subscription, now) },
    });
    await tx.activityLog.create({
      data: {
        userId: paid.userId,
        activity: `Subscribed to ${plan.planName} for ${durationDays} days via ${paid.paymentMethod}`,
        ipAddress: event.source,
      },
    });
    return "activated";
  }, transactionOptions);
}

export async function refundPaidCheckout(
  refund: RefundedPayment,
  event: BillingEvent,
  client: PrismaClient = prisma,
): Promise<"refunded" | "already_processed"> {
  return client.$transaction(async (tx) => {
    await lockPayment(tx, refund.providerPaymentId);
    // This first read discovers immutable ownership, never expiry/refund state.
    const owner = await tx.payment.findUnique({
      where: { providerPaymentId: refund.providerPaymentId },
      select: { subscription: { select: { userId: true } } },
    });
    if (!owner) throw new Error("Refunded PayMongo payment was not found");
    await lockTeacher(tx, owner.subscription.userId);
    const payment = await tx.payment.findUnique({
      where: { providerPaymentId: refund.providerPaymentId },
      include: { subscription: true },
    });
    if (!payment || payment.subscription.userId !== owner.subscription.userId) {
      throw new Error("Refunded PayMongo payment ownership changed");
    }
    const receipt = await eventReceipt(tx, event);
    const refundedAmount = refund.refundedCentavos / 100;
    const previousAmount = Number(payment.refundedAmount);
    if (receipt) {
      if (previousAmount < refundedAmount) throw new Error("PayMongo refund receipt conflicts with persisted refund state");
      return "already_processed";
    }
    // Provider refund snapshots are cumulative. Late/repeated snapshots must
    // not downgrade a full refund and make a later replay subtract twice.
    if (refundedAmount <= previousAmount) {
      await recordEvent(tx, event);
      return "already_processed";
    }
    const now = new Date();
    const fullyRefunded = refundedAmount >= Number(payment.amount);
    const wasFullyRefunded = previousAmount >= Number(payment.amount);
    if (fullyRefunded && !wasFullyRefunded) {
      // Historical paidAt/current-plan duration cannot prove the original
      // grant. Fail atomically rather than deduct another purchase's access.
      if (payment.grantDurationDays === null || !payment.paidAt) {
        throw new Error("Legacy PayMongo payment requires verified entitlement grant backfill before full refund");
      }
      await validateExpiry(tx, payment.subscription, now);
    }
    await recordEvent(tx, event);
    await tx.payment.update({
      where: { id: payment.id },
      data: { refundedAmount, refundedAt: now, paymentStatus: fullyRefunded ? "refunded" : "partially_refunded",
        grantRevokedOn: fullyRefunded && !wasFullyRefunded ? entitlementDay(now) : undefined },
    });
    if (fullyRefunded && !wasFullyRefunded) {
      const adjustedEndDate = await subscriptionExpiry(tx, payment.subscription, now);
      const hasRemainingAccess = adjustedEndDate > now;
      await tx.userSubscription.update({
        where: { id: payment.subscriptionId },
        data: {
          subscriptionStatus: hasRemainingAccess ? "active" : "cancelled",
          paymentStatus: hasRemainingAccess ? "paid" : "refunded",
          endDate: hasRemainingAccess ? adjustedEndDate : now,
        },
      });
    }
    await tx.activityLog.create({
      data: {
        userId: owner.subscription.userId,
        activity: `PayMongo refund recorded for payment ${refund.providerPaymentId}: PHP ${refundedAmount}`,
        ipAddress: event.source,
      },
    });
    return "refunded";
  }, transactionOptions);
}
