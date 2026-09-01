import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// POST: Confirm a simulated successful payment and activate subscription
export async function POST() {
  try {
    const session = await getSession();
    if (!session || session.role !== "teacher") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check if the user already has an active subscription
    const existingSub = await prisma.userSubscription.findFirst({
      where: {
        userId: session.userId,
        subscriptionStatus: "active",
        endDate: { gte: new Date() },
      },
    });

    if (existingSub) {
      return NextResponse.json({ success: true, message: "Already subscribed" });
    }

    // Get the Premium plan
    let plan = await prisma.subscriptionPlan.findFirst({
      where: { planName: "Premium Monthly" },
    });

    if (!plan) {
      plan = await prisma.subscriptionPlan.create({
        data: {
          planName: "Premium Monthly",
          yearlyPrice: 500.0, // Monthly price ₱500.00
          features: "AI Quiz Generation, Live Monitoring, Evidence Replay, AI Reports, Unlimited Quizzes",
          durationDays: 30,
        },
      });
    }

    // Create a new subscription
    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + 30);

    const subscription = await prisma.userSubscription.create({
      data: {
        userId: session.userId,
        planId: plan.id,
        startDate,
        endDate,
        paymentStatus: "paid",
        subscriptionStatus: "active",
      },
    });

    // Create a payment record for the successful transaction
    await prisma.payment.create({
      data: {
        subscriptionId: subscription.id,
        amount: 500.0, // ₱500.00 for monthly
        paymentMethod: "gcash",
        paymentStatus: "completed",
        transactionReference: `MANUAL-${session.userId.slice(0, 8)}-${Date.now()}`,
        paidAt: new Date(),
      },
    });

    // Log Activity
    await prisma.activityLog.create({
      data: {
        userId: session.userId,
        activity: `Upgraded to Premium Monthly`,
        ipAddress: "manual-confirm",
      },
    });

    // Find the admin user to notify
    const adminUser = await prisma.user.findFirst({
      where: { role: { roleName: "admin" } },
    });

    let notificationId = null;

    if (adminUser) {
      const notification = await prisma.notification.create({
        data: {
          userId: adminUser.id,
          title: "New Premium Subscription",
          message: `${session.fullName} has upgraded to the Premium Monthly plan.`,
          isRead: false,
        },
      });
      notificationId = notification.id;
    }

    // Broadcast to Pusher
    try {
      const { pusherServer } = await import("@/lib/pusher");
      
      // Activity feed event
      await pusherServer.trigger("admin-dashboard", "activity", {
        type: "subscription",
        userId: session.userId,
        fullName: session.fullName,
        role: session.role,
        activity: `Upgraded to Premium Yearly`,
        timestamp: new Date().toISOString(),
      });

      // Real-time notification event for the admin
      if (adminUser) {
        await pusherServer.trigger(`user-${adminUser.id}`, "notification", {
          id: notificationId?.toString(),
          title: "New Premium Subscription",
          message: `${session.fullName} has upgraded to the Premium Monthly plan.`,
          createdAt: new Date().toISOString(),
        });
      }
    } catch (e) {
      console.error("Failed to broadcast subscription events:", e);
    }

    return NextResponse.json({ success: true, message: "Subscription activated" });
  } catch (error) {
    console.error("Billing confirm error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
