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

    const activity = await prisma.$transaction(async (tx) => {
      let activity: string | null = null;
      // 2. Update basic status if provided
      if (status && ["active", "suspended"].includes(status)) {
        await tx.user.update({
          where: { id },
          data: { status },
        });

        activity = `Admin ${status === "suspended" ? "suspended" : "restored"} user: ${user.fullName}`;
        // Log the activity
        await tx.activityLog.create({
          data: {
            userId: session.userId,
            activity,
            ipAddress: req.headers.get("x-forwarded-for") || "unknown",
          }
        });
      }

      // 3. Update subscription status if provided and user is a teacher
      if (subscriptionStatus && user.role.roleName === "teacher") {
        const activeSubscription = await tx.userSubscription.findFirst({
          where: {
            userId: id,
            subscriptionStatus: "active",
            endDate: { gt: new Date() },
            plan: { yearlyPrice: { gt: 0 } },
          },
          select: { id: true },
        });

        if (subscriptionStatus === "active" && !activeSubscription) {
          // Find the premium plan
          const premiumPlan = await tx.subscriptionPlan.findFirst({
            where: { planName: { in: ["Premium Monthly", "Premium Yearly"] } },
          });

          if (premiumPlan) {
            const startDate = new Date();
            const endDate = new Date(startDate.getTime() + PRO_SUBSCRIPTION_DURATION_DAYS * 86_400_000);

            await tx.userSubscription.updateMany({
              where: { userId: id, planId: { not: premiumPlan.id }, subscriptionStatus: "active" },
              data: { subscriptionStatus: "cancelled" },
            });
            await tx.userSubscription.upsert({
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

            const subscriptionActivity = `Admin manually granted Pro subscription to: ${user.fullName}`;
            await tx.activityLog.create({
              data: {
                userId: session.userId,
                activity: subscriptionActivity,
                ipAddress: req.headers.get("x-forwarded-for") || "unknown",
              }
            });
            activity ??= subscriptionActivity;
          }
        } else if (subscriptionStatus === "expired" && activeSubscription) {
          // Expire all subscriptions for this user
          await tx.userSubscription.updateMany({
            where: { userId: id },
            data: { subscriptionStatus: "expired" }
          });

          const subscriptionActivity = `Admin manually revoked Pro subscription for: ${user.fullName}`;
          await tx.activityLog.create({
            data: {
              userId: session.userId,
              activity: subscriptionActivity,
              ipAddress: req.headers.get("x-forwarded-for") || "unknown",
            }
          });
          activity ??= subscriptionActivity;
        }
      }
      return activity;
    });

    // 4. Notify admin dashboard clients via Pusher
    try {
      const { pusherServer } = await import("@/lib/pusher");
      await pusherServer.trigger("private-admin-dashboard", "activity", {
        type: "user_update",
        userId: id,
        fullName: user.fullName,
        role: user.role.roleName,
        activity: activity ?? `Admin refreshed user: ${user.fullName}`,
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
