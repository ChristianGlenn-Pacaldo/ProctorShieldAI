import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { PRO_SUBSCRIPTION_DURATION_DAYS } from "@/lib/subscription-rules";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session || session.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body = await req.json();
    const { status, subscriptionStatus } = body;

    // 1. Fetch the user to verify existence and role
    const user = await prisma.user.findUnique({
      where: { id },
      include: { role: true },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // 2. Update basic status if provided
    if (status && ["active", "suspended"].includes(status)) {
      await prisma.user.update({
        where: { id },
        data: { status },
      });
      
      // Log the activity
      await prisma.activityLog.create({
        data: {
          userId: session.userId,
          activity: `Admin ${status === "suspended" ? "suspended" : "restored"} user: ${user.fullName}`,
          ipAddress: req.headers.get("x-forwarded-for") || "unknown",
        }
      });
    }

    // 3. Update subscription status if provided and user is a teacher
    if (subscriptionStatus && user.role.roleName === "teacher") {
      if (subscriptionStatus === "active") {
        // Find the premium plan
        const premiumPlan = await prisma.subscriptionPlan.findFirst({
          where: { planName: { in: ["Premium Monthly", "Premium Yearly"] } },
        });

        if (premiumPlan) {
          const startDate = new Date();
          const endDate = new Date(startDate.getTime() + PRO_SUBSCRIPTION_DURATION_DAYS * 86_400_000);

          await prisma.userSubscription.updateMany({
            where: { userId: id, planId: { not: premiumPlan.id }, subscriptionStatus: "active" },
            data: { subscriptionStatus: "cancelled" },
          });
          await prisma.userSubscription.upsert({
            where: { userId_planId: { userId: id, planId: premiumPlan.id } },
            update: {
              subscriptionStatus: "active",
              paymentStatus: "paid_manual",
              startDate,
              endDate,
            },
            create: {
                userId: id,
                planId: premiumPlan.id,
                startDate,
                endDate,
                subscriptionStatus: "active",
                paymentStatus: "paid_manual",
            },
          });

          await prisma.activityLog.create({
            data: {
              userId: session.userId,
              activity: `Admin manually granted Pro subscription to: ${user.fullName}`,
              ipAddress: req.headers.get("x-forwarded-for") || "unknown",
            }
          });
        }
      } else if (subscriptionStatus === "expired") {
        // Expire all subscriptions for this user
        await prisma.userSubscription.updateMany({
          where: { userId: id },
          data: { subscriptionStatus: "expired" }
        });

        await prisma.activityLog.create({
          data: {
            userId: session.userId,
            activity: `Admin manually revoked Pro subscription for: ${user.fullName}`,
            ipAddress: req.headers.get("x-forwarded-for") || "unknown",
          }
        });
      }
    }

    // 4. Notify admin dashboard clients via Pusher
    try {
      const { pusherServer } = await import("@/lib/pusher");
      await pusherServer.trigger("private-admin-dashboard", "activity", {
        type: "user_update",
        userId: id,
        timestamp: new Date().toISOString(),
      });
    } catch (e) {
      console.error("Failed to trigger pusher:", e);
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error("Failed to update user:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
