import { withBackupWriteGate } from "@/lib/backup-write-gate";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getAdminSession } from "@/lib/auth";
import { isTrustedAuthOrigin } from "@/lib/auth-origin";
import { MissingPremiumPlanError, setManualSubscription, subscriptionTransactionOptions } from "@/lib/paymongo-subscription";

class LastActiveAdminError extends Error {}

async function PUTImpl(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let suspendingAdmin = false;
  if (!isTrustedAuthOrigin(req)) return NextResponse.json({ error: "Forbidden origin" }, { status: 403 });
  try {
    const session = await getAdminSession();
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
      if (subscriptionStatus) {
        const subscriptionActivity = await setManualSubscription(tx, {
          userId: id, actorId: session.userId, action: subscriptionStatus === "active" ? "grant" : "revoke",
          source: req.headers.get("x-forwarded-for") || "unknown",
          revokedStatus: "expired", planNames: "exact",
        });
        activity ??= subscriptionActivity;
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

      return activity;
    }, suspendingAdmin ? { isolationLevel: "Serializable" } : subscriptionStatus ? subscriptionTransactionOptions : undefined);

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

export const PUT = withBackupWriteGate(PUTImpl);
