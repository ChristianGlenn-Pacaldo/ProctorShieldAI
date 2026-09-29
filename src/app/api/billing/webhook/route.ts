import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getPayMongoMode, getPayMongoSecretKey, isPayMongoEventModeAllowed, verifyPayMongoSignature } from "@/lib/paymongo";
import { parsePaidCheckout, parsePaidCheckoutFromCurrentSession, parsePaymongoEventEnvelope, parseRefundedPayment } from "@/lib/paymongo-events";
import { activatePaidCheckout } from "@/lib/paymongo-subscription";
import { Prisma } from "@prisma/client";

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
      let paid = parsePaidCheckout(event.resource);
      if (!paid || paid.paymentStatus !== "paid") {
        const checkoutId = event.resource.id;
        if (typeof checkoutId !== "string" || !checkoutId.startsWith("cs_")) {
          return NextResponse.json({ error: "Invalid checkout session" }, { status: 422 });
        }
        const response = await fetch(
          `https://api.paymongo.com/v1/checkout_sessions/${encodeURIComponent(checkoutId)}`,
          {
            headers: {
              Authorization: "Basic " + Buffer.from(getPayMongoSecretKey() + ":").toString("base64"),
              Accept: "application/json",
            },
            cache: "no-store",
          },
        );
        if (!response.ok) return NextResponse.json({ error: "Checkout verification unavailable" }, { status: 503 });
        const body = await response.json() as { data?: Record<string, unknown> };
        paid = body.data
          ? parsePaidCheckoutFromCurrentSession(event.resource, body.data, event.livemode)
          : null;
        // A premature 2xx acknowledgement would prevent PayMongo from retrying a stale snapshot.
        if (!paid) return NextResponse.json({ error: "Checkout payment not yet verified" }, { status: 503 });
      }
      const activation = await activatePaidCheckout(paid, {
        id: event.id,
        type: event.type,
        source: "paymongo-webhook",
      });
      if (activation === "invalid") {
        console.error("PayMongo webhook referenced invalid payment metadata", event.id);
        return NextResponse.json({ success: true, message: "Ignored invalid payment metadata" });
      }
      if (activation === "already_processed") {
        return NextResponse.json({ success: true, message: "Already processed" });
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
