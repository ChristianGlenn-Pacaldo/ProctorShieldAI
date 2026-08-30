import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { setSessionCookie } from "@/lib/auth";

export async function POST(req: NextRequest) {
  try {
    const { userId, otpCode } = await req.json();

    if (!userId || !otpCode) {
      return NextResponse.json(
        { success: false, message: "Missing required fields" },
        { status: 400 }
      );
    }

    // Find the latest valid OTP for this user
    const otpRecord = await prisma.otpCode.findFirst({
      where: {
        userId: userId,
        code: otpCode,
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

    // Delete the OTP code so it can't be reused
    await prisma.otpCode.delete({
      where: { id: otpRecord.id }
    });

    // Fetch the user to get their details for the session
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { role: true }
    });

    if (!user) {
      return NextResponse.json(
        { success: false, message: "User not found" },
        { status: 404 }
      );
    }

    // Create custom JWT session
    const token = await setSessionCookie({
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
      await pusherServer.trigger("admin-dashboard", "activity", {
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

        await pusherServer.trigger(`user-${adminUser.id}`, "notification", {
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
      token,
    });

  } catch (error: any) {
    console.error("Verify OTP error:", error);
    return NextResponse.json(
      { success: false, message: error.message || "OTP verification failed" },
      { status: 500 }
    );
  }
}
