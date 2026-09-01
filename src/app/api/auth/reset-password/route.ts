import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { hashPassword } from "@/lib/auth";
import { consumeRateLimitGroup, getClientIp, hashOtp, isStrongPassword } from "@/lib/security";

export async function POST(req: NextRequest) {
  try {
    const { email, otpCode, newPassword } = await req.json();
    if (!email || !otpCode || !newPassword) {
      return NextResponse.json(
        { success: false, message: "All fields are required." },
        { status: 400 }
      );
    }
    if (!isStrongPassword(newPassword)) {
      return NextResponse.json(
        { success: false, message: "Password must be 10-128 characters and contain letters and numbers." },
        { status: 400 }
      );
    }
    if (typeof otpCode !== "string" || !/^\d{6}$/.test(otpCode)) {
      return NextResponse.json(
        { success: false, message: "Invalid or expired verification code." },
        { status: 401 }
      );
    }

    const normalizedEmail = String(email).toLowerCase().trim();
    const rateLimit = await consumeRateLimitGroup(
      [`reset-password:ip:${getClientIp(req)}`, `reset-password:account:${normalizedEmail}`],
      8,
      15 * 60 * 1000
    );
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { success: false, message: "Too many attempts. Please try again later." },
        { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
      );
    }

    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (!user || user.status !== "active") {
      return NextResponse.json(
        { success: false, message: "Invalid or expired verification code." },
        { status: 401 }
      );
    }

    const otpRecord = await prisma.otpCode.findFirst({
      where: {
        userId: user.id,
        code: hashOtp(user.id, otpCode, "password-reset"),
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
    });
    if (!otpRecord) {
      return NextResponse.json(
        { success: false, message: "Invalid or expired verification code." },
        { status: 401 }
      );
    }

    const hashedPassword = await hashPassword(newPassword);
    await prisma.$transaction(async (tx) => {
      const consumed = await tx.otpCode.deleteMany({ where: { id: otpRecord.id } });
      if (consumed.count !== 1) throw new Error("OTP already consumed");
      await tx.user.update({ where: { id: user.id }, data: { password: hashedPassword } });
      await tx.activityLog.create({
        data: {
          userId: user.id,
          activity: "Password reset via forgot password flow",
          ipAddress: getClientIp(req),
        },
      });
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
