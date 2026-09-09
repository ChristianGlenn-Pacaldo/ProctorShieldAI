import { after, NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { setSessionCookie } from "@/lib/auth";
import { consumeRateLimitGroup, getClientIp, hashOtp } from "@/lib/security";

export async function POST(req: NextRequest) {
  try {
    const { userId, otpCode } = await req.json();

    if (!userId || !otpCode) {
      return NextResponse.json(
        { success: false, message: "Missing required fields" },
        { status: 400 }
      );
    }

    if (typeof userId !== "string" || typeof otpCode !== "string" || !/^\d{6}$/.test(otpCode)) {
      return NextResponse.json(
        { success: false, message: "Invalid or expired OTP code" },
        { status: 401 }
      );
    }

    const rateLimit = await consumeRateLimitGroup(
      [`verify-otp:ip:${getClientIp(req)}`, `verify-otp:account:${userId}`],
      8,
      15 * 60 * 1000
    );
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { success: false, message: "Too many attempts. Please try again later." },
        { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
      );
    }

    // Find the latest valid OTP for this user
    const otpRecord = await prisma.otpCode.findFirst({
      where: {
        userId: userId,
        code: hashOtp(userId, otpCode, "login"),
        expiresAt: {
          gt: new Date() // Must not be expired
        }
      }
    });

    if (!otpRecord) {
      return NextResponse.json(
        { success: false, message: "Invalid or expired OTP code" },
        { status: 401 }
      );
    }

    // Fetch the user to get their details for the session
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { role: true }
    });

    if (!user || user.status !== "active") {
      return NextResponse.json(
        { success: false, message: "User not found" },
        { status: 404 }
      );
    }

    const consumed = await prisma.otpCode.deleteMany({ where: { id: otpRecord.id } });
    if (consumed.count !== 1) {
      return NextResponse.json(
        { success: false, message: "Invalid or expired OTP code" },
        { status: 401 }
      );
    }

    // Create custom JWT session (sets HttpOnly cookie — token is NOT returned in body for security)
    await setSessionCookie({
      userId: user.id,
      email: user.email,
      role: user.role.roleName.toLowerCase(),
      fullName: user.fullName,
    });

    const ipAddress = req.headers.get("x-forwarded-for") || "unknown";
    after(async () => {
      const results = await Promise.allSettled([
        prisma.activityLog.create({
          data: {
            userId: user.id,
            activity: `Logged in via Google with MFA as ${user.role.roleName}`,
            ipAddress,
          },
        }),
        (async () => {
          const { pusherServer } = await import("@/lib/pusher");
          await pusherServer.trigger("private-admin-dashboard", "activity", {
            type: "login",
            userId: user.id,
            fullName: user.fullName,
            role: user.role.roleName,
            activity: `Logged in via Google with MFA as ${user.role.roleName}`,
            timestamp: new Date().toISOString(),
          });

          const adminUser = await prisma.user.findFirst({
            where: { role: { roleName: "admin" } },
          });
          if (!adminUser) return;

          const notification = await prisma.notification.create({
            data: {
              userId: adminUser.id,
              title: "New Login",
              message: `${user.fullName} (${user.role.roleName}) just logged in.`,
              isRead: false,
            },
          });
          await pusherServer.trigger(`private-user-${adminUser.id}`, "notification", {
            id: notification.id.toString(),
            title: "New Login",
            message: `${user.fullName} (${user.role.roleName}) just logged in.`,
            createdAt: new Date().toISOString(),
          });
        })(),
      ]);
      for (const result of results) {
        if (result.status === "rejected") console.error("Post-MFA-login side effect failed:", result.reason);
      }
    });

    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        role: user.role.roleName.toLowerCase(),
        profileImage: user.profileImage,
      },
    });

  } catch (error: unknown) {
    console.error("Verify OTP error:", error);
    return NextResponse.json(
      { success: false, message: "OTP verification failed. Please try again." },
      { status: 500 }
    );
  }
}
