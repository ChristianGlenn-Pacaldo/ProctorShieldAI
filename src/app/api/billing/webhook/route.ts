import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// POST: PayMongo webhook — called when payment is completed
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const event = body?.data?.attributes;

    if (!event) {
      return NextResponse.json({ error: "Invalid webhook payload" }, { status: 400 });
    }

    const eventType = event.type;

    // Handle successful payment
    if (eventType === "checkout_session.payment.paid") {
      const checkoutData = event.data?.attributes;
      const metadata = checkoutData?.metadata;

      if (!metadata?.userId || !metadata?.planId) {
        console.error("Webhook missing metadata:", metadata);
        return NextResponse.json({ error: "Missing metadata" }, { status: 400 });
      }

      const userId = metadata.userId;
      const planId = parseInt(metadata.planId);
      const referenceNumber = checkoutData?.reference_number || `WH-${Date.now()}`;
      const paymentAmount = (checkoutData?.line_items?.[0]?.amount || 50000) / 100; // Convert centavos to PHP

      // Check if subscription already exists for this reference (idempotency)
      const existingPayment = await prisma.payment.findFirst({
        where: { transactionReference: referenceNumber },
      });

      if (existingPayment) {
        console.log("Webhook: Payment already processed for reference:", referenceNumber);
        return NextResponse.json({ received: true, message: "Already processed" });
      }

      // Create subscription
      const startDate = new Date();
      const endDate = new Date();
      endDate.setDate(endDate.getDate() + 365);

      const subscription = await prisma.userSubscription.create({
        data: {
          userId,
          planId,
          startDate,
          endDate,
          paymentStatus: "paid",
          subscriptionStatus: "active",
        },
      });

      // Create payment record
      await prisma.payment.create({
        data: {
          subscriptionId: subscription.id,
          amount: paymentAmount,
          paymentMethod: "gcash",
          paymentStatus: "completed",
          transactionReference: referenceNumber,
          paidAt: new Date(),
        },
      });

      console.log(`Webhook: Premium subscription activated for user ${userId}`);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("Webhook error:", error);
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}
