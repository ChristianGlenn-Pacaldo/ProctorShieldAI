import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session || session.role !== "teacher") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!process.env.PAYMONGO_SECRET_KEY) {
      console.error("PAYMONGO_SECRET_KEY is missing");
      return NextResponse.json({ error: "Payment gateway is not configured." }, { status: 500 });
    }

    // Get or create the base AI Pro plan
    let plan = await prisma.subscriptionPlan.findFirst({
      where: { planName: "AI Pro - Monthly" }
    });

    if (!plan) {
      plan = await prisma.subscriptionPlan.create({
        data: {
          planName: "AI Pro - Monthly",
          yearlyPrice: 500.00, // Monthly price actually, using existing decimal field
          features: "Unlimited AI Quiz Generation",
          durationDays: 30
        }
      });
    }

    // Determine the base URL for success/cancel redirects
    const protocol = req.headers.get("x-forwarded-proto") || "http";
    const host = req.headers.get("host") || "localhost:3000";
    const baseUrl = `${protocol}://${host}`;

    // Create PayMongo Checkout Session
    const options = {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        authorization: `Basic ${Buffer.from(process.env.PAYMONGO_SECRET_KEY + ':').toString('base64')}`
      },
      body: JSON.stringify({
        data: {
          attributes: {
            send_email_receipt: true,
            show_description: true,
            show_line_items: true,
            payment_method_types: ['gcash', 'paymaya', 'card'],
            line_items: [
              {
                currency: 'PHP',
                amount: 50000, // 500 PHP in cents
                description: 'ProctorShield AI Pro - 30 Days Access',
                name: 'AI Pro Subscription',
                quantity: 1
              }
            ],
            reference_number: `PS_${session.userId.substring(0, 8)}_${Date.now()}`,
            success_url: `${baseUrl}/dashboard/teacher/billing?success=true`,
            cancel_url: `${baseUrl}/dashboard/teacher/billing?canceled=true`,
            metadata: {
              userId: session.userId,
              planId: String(plan.id)
            }
          }
        }
      })
    };

    const response = await fetch('https://api.paymongo.com/v1/checkout_sessions', options);
    const json = await response.json();

    if (!response.ok) {
      console.error("PayMongo Error:", json);
      return NextResponse.json({ error: "Failed to initialize checkout session." }, { status: 500 });
    }

    // Return the checkout URL for the client to redirect
    return NextResponse.json({ 
      success: true, 
      checkoutUrl: json.data.attributes.checkout_url 
    });

  } catch (error: unknown) {
    console.error("Checkout error:", error);
    return NextResponse.json({ error: "An unexpected error occurred." }, { status: 500 });
  }
}
