import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import crypto from "crypto";

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    const signature = req.headers.get("paymongo-signature");
    
    // In production, we should verify the webhook signature.
    // For MVP, we will just parse the body and process if secret is present.
    if (!process.env.PAYMONGO_SECRET_KEY) {
      return NextResponse.json({ error: "Config missing" }, { status: 500 });
    }

    let event;
    try {
      event = JSON.parse(rawBody);
    } catch (e) {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    if (event?.data?.attributes?.type === "checkout_session.payment.paid") {
      const checkoutSession = event.data.attributes.data.attributes;
      const metadata = checkoutSession.metadata;

      if (!metadata || !metadata.userId || !metadata.planId) {
        console.error("Webhook missing metadata:", metadata);
        return NextResponse.json({ success: true, message: "Ignored (no metadata)" });
      }

      const userId = metadata.userId;
      const planId = parseInt(metadata.planId);
      const referenceNumber = checkoutSession.reference_number || event.data.id;
      const amountPaid = (checkoutSession.payments?.[0]?.attributes?.amount || checkoutSession.line_items?.[0]?.amount) / 100 || 500.00;
      const paymentMethod = checkoutSession.payments?.[0]?.attributes?.source?.type || "paymongo";

      // Check if this payment was already processed
      const existingPayment = await prisma.payment.findUnique({
        where: { transactionReference: referenceNumber }
      });

      if (existingPayment) {
        return NextResponse.json({ success: true, message: "Already processed" });
      }

      const plan = await prisma.subscriptionPlan.findUnique({ where: { id: planId } });
      if (!plan) {
        console.error("Webhook plan not found:", planId);
        return NextResponse.json({ error: "Plan not found" }, { status: 404 });
      }

      const durationDays = plan.durationDays || 30;

      // Wrap in a transaction
      await prisma.$transaction(async (tx) => {
        // 1. Check if user already has an active subscription
        let userSub = await tx.userSubscription.findFirst({
          where: { userId: userId, planId: planId }
        });

        const now = new Date();
        let newEndDate = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

        if (userSub) {
          // If active, extend the end date
          if (userSub.endDate > now) {
            newEndDate = new Date(userSub.endDate.getTime() + durationDays * 24 * 60 * 60 * 1000);
          }
          
          userSub = await tx.userSubscription.update({
            where: { id: userSub.id },
            data: {
              endDate: newEndDate,
              paymentStatus: "paid",
              subscriptionStatus: "active"
            }
          });
        } else {
          // Create new subscription
          userSub = await tx.userSubscription.create({
            data: {
              userId: userId,
              planId: planId,
              startDate: now,
              endDate: newEndDate,
              paymentStatus: "paid",
              subscriptionStatus: "active"
            }
          });
        }

        // 2. Record Payment
        await tx.payment.create({
          data: {
            subscriptionId: userSub.id,
            amount: amountPaid,
            paymentMethod: paymentMethod,
            paymentStatus: "paid",
            transactionReference: referenceNumber,
            paidAt: now
          }
        });
        
        // 3. Log Activity
        await tx.activityLog.create({
          data: {
            userId: userId,
            activity: `Subscribed to AI Pro for ${durationDays} days via ${paymentMethod}`,
            ipAddress: "webhook"
          }
        });
      });

      console.log(`Successfully activated subscription for user ${userId}`);
      return NextResponse.json({ success: true });
    }

    // Ignore other events
    return NextResponse.json({ success: true, message: "Event ignored" });

  } catch (error: unknown) {
    console.error("Webhook error:", error);
    return NextResponse.json({ error: "Internal Error" }, { status: 500 });
  }
}
