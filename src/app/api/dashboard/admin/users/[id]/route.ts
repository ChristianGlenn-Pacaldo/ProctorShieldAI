import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getSession();
    if (!session || session.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = params;
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
          where: { id: 2 }, // Premium plan ID
        });

        if (premiumPlan) {
          const startDate = new Date();
          const endDate = new Date();
          endDate.setFullYear(endDate.getFullYear() + 1); // Give 1 year of access

          // Upsert active subscription
          const existingSub = await prisma.userSubscription.findFirst({
            where: { userId: id }
          });

          if (existingSub) {
            await prisma.userSubscription.update({
              where: { id: existingSub.id },
              data: {
                subscriptionStatus: "active",
                planId: premiumPlan.id,
                startDate,
                endDate,
              }
            });
          } else {
            await prisma.userSubscription.create({
              data: {
                userId: id,
                planId: premiumPlan.id,
                startDate,
                endDate,
                subscriptionStatus: "active",
                paymentStatus: "paid_manual",
              }
            });
          }

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
      await pusherServer.trigger("admin-dashboard", "activity", {
        type: "user_update",
        userId: id,
        timestamp: new Date().toISOString(),
      });
    } catch (e) {
      console.error("Failed to trigger pusher:", e);
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Failed to update user:", error);
    return NextResponse.json({ error: error?.message || "Internal Server Error", stack: error?.stack }, { status: 500 });
  }
}
