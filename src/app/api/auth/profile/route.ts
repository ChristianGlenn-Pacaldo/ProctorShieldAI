import { withBackupWriteGate } from "@/lib/backup-write-gate";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getScopedSession, hashPassword, verifyPassword, prepareSessionToken, setPreparedSessionCookie, AuthenticationChangedError } from "@/lib/auth";
import { isTrustedAuthOrigin } from "@/lib/auth-origin";
import { isStrongPassword } from "@/lib/security";

// PUT /api/auth/profile — Update full name and/or password
async function PUTImpl(req: NextRequest) {
  if (!isTrustedAuthOrigin(req)) return NextResponse.json({ error: "Forbidden origin" }, { status: 403 });
  try {
    const session = await getScopedSession(req);
    if (!session) {
      return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { fullName, currentPassword, newPassword } = body;

    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      include: { role: true },
    });

    if (!user) {
      return NextResponse.json({ success: false, message: "User not found" }, { status: 404 });
    }
    if (user.status !== "active" || user.sessionVersion !== session.sessionVersion
      || user.role.roleName.toLowerCase() !== session.role
      || (session.role === "admin" ? "admin" : "user") !== session.sessionClass) {
      throw new AuthenticationChangedError();
    }

    const updateData: { fullName?: string; password?: string; sessionVersion?: { increment: number } } = {};

    // Update name if provided
    if (fullName !== undefined && (
      typeof fullName !== "string"
      || fullName.trim().length < 2
      || fullName.trim().length > 150
    )) {
      return NextResponse.json(
        { success: false, message: "Name must be between 2 and 150 characters." },
        { status: 400 },
      );
    }
    if (fullName && fullName.trim() !== user.fullName) {
      updateData.fullName = fullName.trim();
    }

    // Update password if provided
    if (newPassword) {
      if (!currentPassword) {
        return NextResponse.json(
          { success: false, message: "Current password is required to set a new password." },
          { status: 400 }
        );
      }
      if (!isStrongPassword(newPassword)) {
        return NextResponse.json(
          { success: false, message: "New password must be 10-128 characters and contain letters and numbers." },
          { status: 400 }
        );
      }
      const isValid = await verifyPassword(currentPassword, user.password);
      if (!isValid) {
        return NextResponse.json(
          { success: false, message: "Current password is incorrect." },
          { status: 400 }
        );
      }
      updateData.password = await hashPassword(newPassword);
      updateData.sessionVersion = { increment: 1 };
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ success: true, message: "No changes to save." });
    }

    const token = await prisma.$transaction(async (tx) => {
      const updatedUser = await tx.user.update({
        where: { id: session.userId, status: "active", sessionVersion: session.sessionVersion,
          password: user.password, role: { roleName: { equals: session.role, mode: "insensitive" } } },
        data: updateData,
      });
      const prepared = await prepareSessionToken({
        userId: session.userId, email: updatedUser.email, role: session.role, fullName: updatedUser.fullName,
      }, { userId: session.userId, role: session.role, sessionVersion: updatedUser.sessionVersion, password: updatedUser.password }, tx);
      await tx.activityLog.create({ data: {
        userId: session.userId, activity: "Updated profile settings", ipAddress: req.headers.get("x-forwarded-for") || "unknown",
      } });
      return prepared;
    });
    await setPreparedSessionCookie(token);

    return NextResponse.json({ success: true, message: "Profile updated successfully." });
  } catch (error: unknown) {
    if (error instanceof AuthenticationChangedError || (error as { code?: string })?.code === "P2025") return NextResponse.json({ error: "Authentication changed; sign in again" }, { status: 401 });
    console.error("Profile update error:");
    return NextResponse.json(
      { success: false, message: "Failed to update profile. Please try again." },
      { status: 500 }
    );
  }
}

export const PUT = withBackupWriteGate(PUTImpl);
