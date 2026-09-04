import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session || session.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body = await req.json();
    const { status, plan } = body;

    const user = await prisma.user.findUnique({
      where: { id },
      include: { role: true, userSubscriptions: true },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Handle Status Toggle (Suspend/Restore)
    if (status && (status === "active" || status === "suspended")) {
      await prisma.user.update({
        where: { id },
        data: { status },
      });
    }

    // Handle Plan Update (Premium / Free Tier) - Only applies to teachers
    if (plan && user.role.roleName === "teacher") {
      if (plan === "Premium") {
        const premiumPlan = await prisma.subscriptionPlan.findFirst({
          where: { planName: { contains: "Premium" } }
        });
        
        if (premiumPlan) {
          // Deactivate any other active plan before granting Premium.
          await prisma.userSubscription.updateMany({
            where: { userId: id, planId: { not: premiumPlan.id }, subscriptionStatus: "active" },
            data: { subscriptionStatus: "cancelled" }
          });

          const startDate = new Date();
          const endDate = new Date(startDate);
          endDate.setFullYear(endDate.getFullYear() + 1);
          await prisma.userSubscription.upsert({
            where: { userId_planId: { userId: id, planId: premiumPlan.id } },
            update: {
              startDate,
              endDate,
              paymentStatus: "paid_manual",
              subscriptionStatus: "active",
            },
            create: {
              userId: id,
              planId: premiumPlan.id,
              startDate,
              endDate,
              paymentStatus: "paid_manual",
              subscriptionStatus: "active",
            }
          });
        }
      } else if (plan === "Free Tier") {
        // Just cancel the active subscription
        await prisma.userSubscription.updateMany({
          where: { userId: id, subscriptionStatus: "active" },
          data: { subscriptionStatus: "cancelled" }
        });
      }
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("User update error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
