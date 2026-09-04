import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { getPayMongoMode, isPayMongoEventModeAllowed, verifyPayMongoSignature } from "@/lib/paymongo";
import { parsePaidCheckout, parsePaymongoEventEnvelope, parseRefundedPayment } from "@/lib/paymongo-events";

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    const signature = req.headers.get("paymongo-signature");
    if (!signature) return NextResponse.json({ error: "Missing signature" }, { status: 401 });
    const webhookSecret = process.env.PAYMONGO_WEBHOOK_SECRET;
    if (!webhookSecret) return NextResponse.json({ error: "Config missing" }, { status: 500 });
    const signatureMode = verifyPayMongoSignature(rawBody, signature, webhookSecret);
    if (!signatureMode) return NextResponse.json({ error: "Invalid signature" }, { status: 401 });

    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const event = parsePaymongoEventEnvelope(body);
    if (!event) return NextResponse.json({ error: "Invalid event" }, { status: 400 });
    if ((event.livemode && signatureMode !== "li") || (!event.livemode && signatureMode !== "te")) {
      return NextResponse.json({ error: "Signature mode mismatch" }, { status: 401 });
    }
    if (!isPayMongoEventModeAllowed(event.livemode)) {
      console.error(`Rejected ${event.livemode ? "live" : "test"} PayMongo event while PAYMONGO_MODE=${getPayMongoMode()}`);
      return NextResponse.json({ error: "Payment mode mismatch" }, { status: 403 });
    }

    if (event.type === "checkout_session.payment.paid") {
      const paid = parsePaidCheckout(event.resource);
      if (!paid) return NextResponse.json({ success: true, message: "Ignored invalid payment data" });
      const [user, plan] = await Promise.all([
        prisma.user.findFirst({ where: { id: paid.userId, role: { roleName: "teacher" } } }),
        prisma.subscriptionPlan.findUnique({ where: { id: paid.planId } }),
      ]);
      if (!user || !plan || plan.yearlyPrice === null) {
        console.error("PayMongo webhook referenced an invalid user or plan", event.id);
        return NextResponse.json({ success: true, message: "Ignored invalid metadata" });
      }
      const expectedCentavos = Math.round(Number(plan.yearlyPrice) * 100);
      if (paid.amountCentavos !== expectedCentavos) {
        console.error("PayMongo amount mismatch", { eventId: event.id, expectedCentavos, received: paid.amountCentavos });
        return NextResponse.json({ success: true, message: "Ignored amount mismatch" });
      }

      try {
        await prisma.$transaction(async (tx) => {
          await tx.webhookEvent.create({ data: { provider: "paymongo", eventId: event.id, eventType: event.type } });
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
              ipAddress: "paymongo-webhook",
            },
          });
        });
      } catch (error) {
        if (isUniqueConstraintError(error)) return NextResponse.json({ success: true, message: "Already processed" });
        throw error;
      }
      return NextResponse.json({ success: true });
    }

    if (event.type === "payment.refunded" || event.type === "payment.refund.updated") {
      const refund = parseRefundedPayment(event.resource);
      if (!refund) return NextResponse.json({ success: true, message: "Ignored invalid refund data" });
      try {
        await prisma.$transaction(async (tx) => {
          await tx.webhookEvent.create({ data: { provider: "paymongo", eventId: event.id, eventType: event.type } });
          const payment = await tx.payment.findUnique({
            where: { providerPaymentId: refund.providerPaymentId },
            include: { subscription: { include: { plan: true } } },
          });
          if (!payment) throw new Error("Refunded PayMongo payment was not found");
          const refundedAmount = refund.refundedCentavos / 100;
          const fullyRefunded = refundedAmount >= Number(payment.amount);
          const wasFullyRefunded = Number(payment.refundedAmount) >= Number(payment.amount);
          await tx.payment.update({
            where: { id: payment.id },
            data: {
              refundedAmount,
              refundedAt: new Date(),
              paymentStatus: fullyRefunded ? "refunded" : "partially_refunded",
            },
          });
          if (fullyRefunded && !wasFullyRefunded) {
            const durationDays = payment.subscription.plan.durationDays ?? 30;
            const now = new Date();
            const adjustedEndDate = new Date(
              payment.subscription.endDate.getTime() - durationDays * 86_400_000,
            );
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
        });
      } catch (error) {
        if (isUniqueConstraintError(error)) return NextResponse.json({ success: true, message: "Already processed" });
        throw error;
      }
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ success: true, message: "Event ignored" });
  } catch (error: unknown) {
    console.error("Webhook error:", error);
    return NextResponse.json({ error: "Internal Error" }, { status: 500 });
  }
}
