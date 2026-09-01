import { NextRequest, NextResponse } from "next/server";
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

    // Set user online in database
    await prisma.user.update({
      where: { id: user.id },
      data: { isOnline: true },
    });

    // Log activity
    await prisma.activityLog.create({
      data: {
        userId: user.id,
        activity: `Logged in via Google with MFA as ${user.role.roleName}`,
        ipAddress: req.headers.get("x-forwarded-for") || "unknown",
      },
    });

    // Broadcast activity to admin
    try {
      const { pusherServer } = await import("@/lib/pusher");
      await pusherServer.trigger("private-admin-dashboard", "activity", {
        type: "login",
        userId: user.id,
        fullName: user.fullName,
        role: user.role.roleName,
        activity: `Logged in via Google with MFA as ${user.role.roleName}`,
        timestamp: new Date().toISOString(),
      });

      // Send a personal notification to the admin if it's a student (or teacher)
      const adminUser = await prisma.user.findFirst({
        where: { role: { roleName: "admin" } },
      });

      if (adminUser) {
        let notificationId = null;
        const notification = await prisma.notification.create({
          data: {
            userId: adminUser.id,
            title: "New Login",
            message: `${user.fullName} (${user.role.roleName}) just logged in.`,
            isRead: false,
          },
        });
        notificationId = notification.id;

        await pusherServer.trigger(`private-user-${adminUser.id}`, "notification", {
          id: notificationId?.toString(),
          title: "New Login",
          message: `${user.fullName} (${user.role.roleName}) just logged in.`,
          createdAt: new Date().toISOString(),
        });
      }
    } catch (e) {
      console.error("Failed to broadcast MFA login to admin:", e);
    }

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
