import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { sendOtpEmail } from "@/lib/email";
import { consumeRateLimitGroup, generateOtp, getClientIp, hashOtp } from "@/lib/security";

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();
    if (!email || typeof email !== "string") {
      return NextResponse.json(
        { success: false, message: "Email is required." },
        { status: 400 }
      );
    }

    const normalizedEmail = email.toLowerCase().trim();
    const rateLimit = await consumeRateLimitGroup(
      [`forgot-password:ip:${getClientIp(req)}`, `forgot-password:account:${normalizedEmail}`],
      5,
      15 * 60 * 1000
    );
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { success: false, message: "Too many requests. Please try again later." },
        { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
      );
    }

    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (user?.status === "active") {
      await prisma.otpCode.deleteMany({ where: { userId: user.id } });
      const code = generateOtp();
      await prisma.otpCode.create({
        data: {
          userId: user.id,
          code: hashOtp(user.id, code, "password-reset"),
          expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        },
      });
      await sendOtpEmail(user.email, code).catch((error: unknown) =>
        console.error("Failed to send password reset email:", error)
      );
    }

    return NextResponse.json({
      success: true,
      message: "If that email is registered, a reset code has been sent.",
    });
  } catch (error: unknown) {
    console.error("Forgot password error:", error);
    return NextResponse.json(
      { success: false, message: "An unexpected error occurred." },
      { status: 500 }
    );
  }
}
