import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { hashPassword } from "@/lib/auth";

// POST /api/auth/reset-password
// Body: { userId, otpCode, newPassword }
export async function POST(req: NextRequest) {
  try {
    const { userId, otpCode, newPassword } = await req.json();

    if (!userId || !otpCode || !newPassword) {
      return NextResponse.json(
        { success: false, message: "All fields are required." },
        { status: 400 }
      );
    }

    if (newPassword.length < 6) {
      return NextResponse.json(
        { success: false, message: "Password must be at least 6 characters." },
        { status: 400 }
      );
    }

    // Verify OTP
    const otpRecord = await prisma.otpCode.findFirst({
      where: {
        userId,
        code: otpCode,
        expiresAt: { gt: new Date() },
      },
    });

    if (!otpRecord) {
      return NextResponse.json(
        { success: false, message: "Invalid or expired verification code." },
        { status: 401 }
      );
    }

    // Delete OTP so it can't be reused
    await prisma.otpCode.delete({ where: { id: otpRecord.id } });

    // Hash and update password
    const hashedPassword = await hashPassword(newPassword);
    await prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword },
    });

    // Log the activity
    await prisma.activityLog.create({
      data: {
        userId,
        activity: "Password reset via forgot password flow",
        ipAddress: req.headers.get("x-forwarded-for") || "unknown",
      },
    });

    return NextResponse.json({
      success: true,
      message: "Password has been reset successfully. You can now log in.",
    });
  } catch (error: unknown) {
    console.error("Reset password error:", error);
    return NextResponse.json(
      { success: false, message: "An unexpected error occurred." },
      { status: 500 }
    );
  }
}
