import { withBackupWriteGate } from "@/lib/backup-write-gate";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { PRO_SUBSCRIPTION_DURATION_DAYS } from "@/lib/subscription-rules";

class LastActiveAdminError extends Error {}
class MissingPremiumPlanError extends Error {}

async function PUTImpl(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
    if (fields.length === 0 || fields.some((field) => !["status", "plan"].includes(field))) {
      return NextResponse.json({ error: "Unsupported user update fields" }, { status: 400 });
    }
    const { status, plan } = body;
    if (("status" in body && !["active", "suspended"].includes(status))
      || ("plan" in body && !["Premium", "Free Tier"].includes(plan))) {
      return NextResponse.json({ error: "Invalid user status or subscription plan" }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { id },
      include: { role: true, userSubscriptions: true },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    if (plan && user.role.roleName !== "teacher") {
      return NextResponse.json({ error: "Subscriptions can only be changed for Teachers" }, { status: 400 });
    }

    suspendingAdmin = status === "suspended" && user.role.roleName === "admin";
    if (suspendingAdmin && id === session.userId) {
      return NextResponse.json({ error: "You cannot suspend your own Admin account" }, { status: 400 });
    }

    await prisma.$transaction(async (tx) => {
      if (suspendingAdmin) {
        const activeAdmins = await tx.user.count({ where: { roleId: user.roleId, status: "active" } });
        if (activeAdmins <= 1) throw new LastActiveAdminError("Cannot suspend the last active Admin account");
      }
      const activeSubscription = plan ? await tx.userSubscription.findFirst({
        where: {
          userId: id,
          subscriptionStatus: "active",
          endDate: { gt: new Date() },
          plan: { yearlyPrice: { gt: 0 } },
        },
        select: { id: true },
      }) : null;
      const premiumPlan = plan === "Premium" && !activeSubscription
        ? await tx.subscriptionPlan.findFirst({
          where: { planName: { contains: "Premium" }, yearlyPrice: { gt: 0 } }
        })
        : null;
      if (plan === "Premium" && !activeSubscription && !premiumPlan) {
        throw new MissingPremiumPlanError("No valid paid Premium plan is available");
      }
      // Handle Status Toggle (Suspend/Restore)
      if (status && (status === "active" || status === "suspended")) {
        await tx.user.update({
          where: { id },
          data: { status },
        });
      }

      // Handle Plan Update (Premium / Free Tier) - Only applies to teachers
      if (plan && user.role.roleName === "teacher") {
        if (plan === "Premium" && !activeSubscription) {
          if (!premiumPlan) throw new MissingPremiumPlanError("No valid paid Premium plan is available");
          // Deactivate any other active plan before granting Premium.
          await tx.userSubscription.updateMany({
            where: { userId: id, planId: { not: premiumPlan.id }, subscriptionStatus: "active" },
            data: { subscriptionStatus: "cancelled" }
          });

          const startDate = new Date();
          const endDate = new Date(startDate.getTime() + PRO_SUBSCRIPTION_DURATION_DAYS * 86_400_000);
          await tx.userSubscription.upsert({
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
        } else if (plan === "Free Tier" && activeSubscription) {
          // Just cancel the active subscription
          await tx.userSubscription.updateMany({
            where: { userId: id, subscriptionStatus: "active" },
            data: { subscriptionStatus: "cancelled" }
          });
        }
      }
    }, suspendingAdmin ? { isolationLevel: "Serializable" } : undefined);

    return NextResponse.json({ success: true });
  } catch (error: any) {
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
    console.error("User update error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export const PUT = withBackupWriteGate(PUTImpl);
