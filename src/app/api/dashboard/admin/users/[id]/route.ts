import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { PRO_SUBSCRIPTION_DURATION_DAYS } from "@/lib/subscription-rules";

class LastActiveAdminError extends Error {}
class MissingPremiumPlanError extends Error {}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let suspendingAdmin = false;
  try {
    const session = await getSession();
    if (!session || session.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Invalid user update request" }, { status: 400 });
    }
    const fields = Object.keys(body);
    if (fields.length === 0 || fields.some((field) => !["status", "subscriptionStatus"].includes(field))) {
      return NextResponse.json({ error: "Unsupported user update fields" }, { status: 400 });
    }
    const { status, subscriptionStatus } = body;
    if (("status" in body && !["active", "suspended"].includes(status))
      || ("subscriptionStatus" in body && !["active", "expired"].includes(subscriptionStatus))) {
      return NextResponse.json({ error: "Invalid user status or subscription status" }, { status: 400 });
    }

    // 1. Fetch the user to verify existence and role
    const user = await prisma.user.findUnique({
      where: { id },
      include: { role: true },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    if (subscriptionStatus && user.role.roleName !== "teacher") {
      return NextResponse.json({ error: "Subscriptions can only be changed for Teachers" }, { status: 400 });
    }

    suspendingAdmin = status === "suspended" && user.role.roleName === "admin";
    if (suspendingAdmin && id === session.userId) {
      return NextResponse.json({ error: "You cannot suspend your own Admin account" }, { status: 400 });
    }

    const activity = await prisma.$transaction(async (tx) => {
      let activity: string | null = null;
      if (suspendingAdmin) {
        const activeAdmins = await tx.user.count({ where: { roleId: user.roleId, status: "active" } });
        if (activeAdmins <= 1) throw new LastActiveAdminError("Cannot suspend the last active Admin account");
      }
      const activeSubscription = subscriptionStatus ? await tx.userSubscription.findFirst({
        where: {
          userId: id,
          subscriptionStatus: "active",
          endDate: { gt: new Date() },
          plan: { yearlyPrice: { gt: 0 } },
        },
        select: { id: true },
      }) : null;
      const premiumPlan = subscriptionStatus === "active" && !activeSubscription
        ? await tx.subscriptionPlan.findFirst({
          where: { planName: { in: ["Premium Monthly", "Premium Yearly"] }, yearlyPrice: { gt: 0 } },
        })
        : null;
      if (subscriptionStatus === "active" && !activeSubscription && !premiumPlan) {
        throw new MissingPremiumPlanError("No valid paid Premium plan is available");
      }
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
        if (subscriptionStatus === "active" && !activeSubscription) {
          if (!premiumPlan) throw new MissingPremiumPlanError("No valid paid Premium plan is available");
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
    }, suspendingAdmin ? { isolationLevel: "Serializable" } : undefined);

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
    if (error instanceof LastActiveAdminError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof MissingPremiumPlanError) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    const conflict = error as { code?: string; cause?: { originalCode?: string } };
    if (suspendingAdmin && (conflict?.code === "P2034" || conflict?.cause?.originalCode === "40001")) {
      return NextResponse.json({ error: "Concurrent Admin status change; suspension was not applied. At least one Admin must remain active." }, { status: 409 });
    }
    console.error("Failed to update user:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
