import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession, hashPassword, verifyPassword, setSessionCookie } from "@/lib/auth";

// PUT /api/auth/profile — Update full name and/or password
export async function PUT(req: NextRequest) {
  try {
    const session = await getSession();
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

    const updateData: { fullName?: string; password?: string } = {};

    // Update name if provided
    if (fullName && fullName.trim() && fullName.trim() !== user.fullName) {
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
      if (newPassword.length < 6) {
        return NextResponse.json(
          { success: false, message: "New password must be at least 6 characters." },
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
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ success: true, message: "No changes to save." });
    }

    const updatedUser = await prisma.user.update({
      where: { id: session.userId },
      data: updateData,
    });

    // Refresh session cookie with updated name
    await setSessionCookie({
      userId: updatedUser.id,
      email: updatedUser.email,
      role: user.role.roleName.toLowerCase(),
      fullName: updatedUser.fullName,
    });

    // Log activity
    await prisma.activityLog.create({
      data: {
        userId: session.userId,
        activity: "Updated profile settings",
        ipAddress: req.headers.get("x-forwarded-for") || "unknown",
      },
    });

    return NextResponse.json({ success: true, message: "Profile updated successfully." });
  } catch (error: unknown) {
    console.error("Profile update error:", error);
    return NextResponse.json(
      { success: false, message: "Failed to update profile. Please try again." },
      { status: 500 }
    );
  }
}
