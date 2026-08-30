import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// GET: Check teacher's current subscription status
export async function GET() {
  try {
    const session = await getSession();
    if (!session || session.role !== "teacher") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Find active subscription
    const subscription = await prisma.userSubscription.findFirst({
      where: {
        userId: session.userId,
        subscriptionStatus: "active",
      },
      include: {
        plan: true,
        payments: {
          orderBy: { paidAt: "desc" },
          take: 10,
        },
      },
    });

    // Check if subscription is still valid (not expired)
    let isActive = false;
    if (subscription) {
      const now = new Date();
      isActive = subscription.endDate >= now && subscription.subscriptionStatus === "active";
    }

    // Get all payment history
    const payments = await prisma.payment.findMany({
      where: {
        subscription: {
          userId: session.userId,
        },
      },
      orderBy: { paidAt: "desc" },
      take: 20,
    });

    return NextResponse.json({
      isSubscribed: isActive,
      subscription: subscription
        ? {
            id: subscription.id,
            planName: subscription.plan.planName,
            startDate: subscription.startDate,
            endDate: subscription.endDate,
            status: subscription.subscriptionStatus,
            price: subscription.plan.yearlyPrice,
          }
        : null,
      payments: payments.map((p) => ({
        id: p.id,
        amount: p.amount,
        method: p.paymentMethod,
        status: p.paymentStatus,
        reference: p.transactionReference,
        paidAt: p.paidAt,
      })),
    });
  } catch (error) {
    console.error("Billing GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST: Create PayMongo checkout session for Premium upgrade
export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session || session.role !== "teacher") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const PAYMONGO_SECRET_KEY = process.env.PAYMONGO_SECRET_KEY;
    const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

    if (!PAYMONGO_SECRET_KEY) {
      return NextResponse.json(
        { error: "PayMongo is not configured. Please add PAYMONGO_SECRET_KEY to your .env file." },
        { status: 500 }
      );
    }

    // Check if already subscribed
    const existingSub = await prisma.userSubscription.findFirst({
      where: {
        userId: session.userId,
        subscriptionStatus: "active",
        endDate: { gte: new Date() },
      },
    });

    if (existingSub) {
      return NextResponse.json({ error: "You already have an active subscription" }, { status: 400 });
    }

    // Upsert the Premium plan in the database
    let plan = await prisma.subscriptionPlan.findFirst({
      where: { planName: "Premium Yearly" },
    });

    if (!plan) {
      plan = await prisma.subscriptionPlan.create({
        data: {
          planName: "Premium Yearly",
          yearlyPrice: 500.0,
          features: "AI Quiz Generation, Live Monitoring, Evidence Replay, AI Reports, Unlimited Quizzes",
          durationDays: 365,
        },
      });
    }

    // Create PayMongo checkout session
    const response = await fetch("https://api.paymongo.com/v2/checkout_sessions", {
      method: "POST",
      headers: {
        Authorization: "Basic " + Buffer.from(PAYMONGO_SECRET_KEY + ":").toString("base64"),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        data: {
          attributes: {
            line_items: [
              {
                name: "ProctorShield AI — Premium Yearly",
                description: "Full AI proctoring, live monitoring, evidence replay, AI reports, and unlimited quizzes for 1 year.",
                amount: 50000, // ₱500.00 in centavos
                currency: "PHP",
                quantity: 1,
              },
            ],
            payment_method_types: ["gcash", "card"],
            success_url: `${APP_URL}/dashboard/teacher/billing?payment=success`,
            cancel_url: `${APP_URL}/dashboard/teacher/billing?payment=cancelled`,
            reference_number: `PS-${session.userId.slice(0, 8)}-${Date.now()}`,
            metadata: {
              userId: session.userId,
              planId: String(plan.id),
            },
          },
        },
      }),
    });

    const paymongoData = await response.json();

    if (!response.ok) {
      console.error("PayMongo error:", paymongoData);
      return NextResponse.json(
        { error: paymongoData?.errors?.[0]?.detail || "Failed to create checkout session" },
        { status: 500 }
      );
    }

    const checkoutUrl = paymongoData.data.attributes.checkout_url;
    const checkoutSessionId = paymongoData.data.id;

    return NextResponse.json({
      success: true,
      checkoutUrl,
      checkoutSessionId,
    });
  } catch (error: any) {
    console.error("Billing POST error:", error);
    return NextResponse.json({ error: error?.message || "Internal server error" }, { status: 500 });
  }
}
