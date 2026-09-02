import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import crypto from "crypto";
import { expireSubscriptions } from "@/lib/maintenance";
import { getPayMongoMode, getPayMongoSecretKey } from "@/lib/paymongo";

// GET: Check teacher's current subscription status
export async function GET() {
  try {
    const session = await getSession();
    if (!session || session.role !== "teacher") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    await expireSubscriptions(session.userId);

    // Find active subscription
    const subscription = await prisma.userSubscription.findFirst({
      where: {
        userId: session.userId,
        subscriptionStatus: "active",
        endDate: { gt: new Date() },
        plan: { yearlyPrice: { gt: 0 } },
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
    const isActive = Boolean(subscription);

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
      paymentMode: getPayMongoMode(),
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
export async function POST() {
  try {
    const session = await getSession();
    if (!session || session.role !== "teacher") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const appUrlValue = process.env.NEXT_PUBLIC_APP_URL || (process.env.NODE_ENV === "production" ? "" : "http://localhost:3000");

    if (!appUrlValue) {
      return NextResponse.json(
        { error: "Application URL is not configured." },
        { status: 500 }
      );
    }
    let paymongoSecretKey: string;
    try {
      paymongoSecretKey = getPayMongoSecretKey();
    } catch (error) {
      console.error("PayMongo configuration error:", error instanceof Error ? error.message : error);
      return NextResponse.json({ error: "PayMongo test mode is not configured correctly." }, { status: 500 });
    }
    await expireSubscriptions(session.userId);

    let appUrl: URL;
    try {
      appUrl = new URL(appUrlValue);
    } catch {
      return NextResponse.json({ error: "Application URL is not configured correctly." }, { status: 500 });
    }
    if (process.env.NODE_ENV === "production" && appUrl.protocol !== "https:") {
      return NextResponse.json({ error: "Production payment redirects require HTTPS." }, { status: 500 });
    }

    // Check if already subscribed
    const existingSub = await prisma.userSubscription.findFirst({
      where: {
        userId: session.userId,
        subscriptionStatus: "active",
        endDate: { gt: new Date() },
        plan: { yearlyPrice: { gt: 0 } },
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
    if (plan.yearlyPrice === null) {
      return NextResponse.json({ error: "Subscription plan price is not configured" }, { status: 500 });
    }
    const checkoutAmount = Math.round(Number(plan.yearlyPrice) * 100);

    // Create PayMongo checkout session
    const response = await fetch("https://api.paymongo.com/v1/checkout_sessions", {
      method: "POST",
      headers: {
        Authorization: "Basic " + Buffer.from(paymongoSecretKey + ":").toString("base64"),
        "Content-Type": "application/json",
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify({
        data: {
          attributes: {
            line_items: [
              {
                name: "ProctorShield AI — Premium Yearly",
                description: "Full AI proctoring, live monitoring, evidence replay, AI reports, and unlimited quizzes for 1 year.",
                amount: checkoutAmount,
                currency: "PHP",
                quantity: 1,
              },
            ],
            payment_method_types: ["gcash", "card"],
            success_url: new URL("/dashboard/teacher/billing?payment=success", appUrl).toString(),
            cancel_url: new URL("/dashboard/teacher/billing?payment=cancelled", appUrl).toString(),
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
        { error: "Failed to create checkout session" },
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
  } catch (error: unknown) {
    console.error("Billing POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
