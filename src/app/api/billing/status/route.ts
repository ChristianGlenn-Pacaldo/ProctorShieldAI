import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// GET: Lightweight subscription status check (used by gating modals)
export async function GET() {
  try {
    const session = await getSession();
    if (!session || session.role !== "teacher") {
      return NextResponse.json({ isSubscribed: false });
    }

    const subscription = await prisma.userSubscription.findFirst({
      where: {
        userId: session.userId,
        subscriptionStatus: "active",
        endDate: { gte: new Date() },
      },
    });

    return NextResponse.json({ isSubscribed: !!subscription });
  } catch (error) {
    console.error("Billing status error:", error);
    return NextResponse.json({ isSubscribed: false });
  }
}
