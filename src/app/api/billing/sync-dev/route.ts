import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";

// This endpoint is used strictly for local development to bypass Ngrok webhook complexities
export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session || session.role !== "teacher") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Only allow this mock sync in development
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json({ error: "Not allowed in production" }, { status: 403 });
    }

    const plan = await prisma.subscriptionPlan.findFirst({
      where: { planName: "AI Pro - Monthly" }
    });

    if (!plan) {
      return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    }

    // Wrap in a transaction
    await prisma.$transaction(async (tx) => {
      // 1. Check if user already has an active subscription
      let userSub = await tx.userSubscription.findFirst({
        where: { userId: session.userId, planId: plan.id }
      });

      const now = new Date();
      let newEndDate = new Date(now.getTime() + plan.durationDays * 24 * 60 * 60 * 1000);

      if (userSub) {
        if (userSub.endDate > now) {
          newEndDate = new Date(userSub.endDate.getTime() + plan.durationDays * 24 * 60 * 60 * 1000);
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
        userSub = await tx.userSubscription.create({
          data: {
            userId: session.userId,
            planId: plan.id,
            startDate: now,
            endDate: newEndDate,
            paymentStatus: "paid",
            subscriptionStatus: "active"
          }
        });
      }

      // 2. Record Payment Mock
      await tx.payment.create({
        data: {
          subscriptionId: userSub.id,
          amount: 500, // mock amount
          paymentMethod: "gcash (mock)",
          paymentStatus: "paid",
          transactionReference: `DEV_MOCK_${Date.now()}`,
          paidAt: now
        }
      });
      
      // 3. Log Activity
      await tx.activityLog.create({
        data: {
          userId: session.userId,
          activity: `Subscribed to AI Pro for ${plan.durationDays} days via DEV Mock`,
          ipAddress: "localhost"
        }
      });
    });

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error("Dev Sync Error:", error);
    return NextResponse.json({ error: "Internal Error" }, { status: 500 });
  }
}
