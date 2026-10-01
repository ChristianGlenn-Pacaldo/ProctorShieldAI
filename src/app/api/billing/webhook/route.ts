import { withBackupWriteGate } from "@/lib/backup-write-gate";
import { NextRequest, NextResponse } from "next/server";
import { getPayMongoMode, getPayMongoSecretKey, isPayMongoEventModeAllowed, verifyPayMongoSignature } from "@/lib/paymongo";
import { parsePaidCheckout, parsePaidCheckoutFromCurrentSession, parsePaymongoEventEnvelope, parseRefundedPayment } from "@/lib/paymongo-events";
import { activatePaidCheckout, refundPaidCheckout } from "@/lib/paymongo-subscription";

async function POSTImpl(req: NextRequest) {
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
      const result = await refundPaidCheckout(refund, {
        id: event.id, type: event.type, source: "paymongo-webhook",
      });
      if (result === "already_processed") return NextResponse.json({ success: true, message: "Already processed" });
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ success: true, message: "Event ignored" });
  } catch (error: unknown) {
    console.error("Webhook error:", error);
    return NextResponse.json({ error: "Internal Error" }, { status: 500 });
  }
}

export const POST = withBackupWriteGate(POSTImpl);
