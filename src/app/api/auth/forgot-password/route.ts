import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { sendOtpEmail } from "@/lib/email";

// POST /api/auth/forgot-password
// Body: { email }
export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();

    if (!email || typeof email !== "string") {
      return NextResponse.json(
        { success: false, message: "Email is required." },
        { status: 400 }
      );
    }

    // Find the user — respond generically even if not found (security best practice)
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });

    if (user) {
      // Delete any existing OTPs for this user
      await prisma.otpCode.deleteMany({ where: { userId: user.id } });

      // Generate 6-digit OTP
      const code = Math.floor(100000 + Math.random() * 900000).toString();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

      await prisma.otpCode.create({
        data: {
          userId: user.id,
          code,
          expiresAt,
        },
      });

      // Send email (non-blocking failure — don't expose email errors to client)
      await sendOtpEmail(user.email, code).catch((e) =>
        console.error("Failed to send password reset email:", e)
      );
    }

    // Always return success to prevent user enumeration
    return NextResponse.json({
      success: true,
      message: "If that email is registered, a reset code has been sent.",
      // Return userId only if user exists (needed for the reset step)
      userId: user?.id || null,
    });
  } catch (error: unknown) {
    console.error("Forgot password error:", error);
    return NextResponse.json(
      { success: false, message: "An unexpected error occurred." },
      { status: 500 }
    );
  }
}
