import { NextRequest, NextResponse } from "next/server";
import { clearSession, getSession } from "@/lib/auth";
import prisma from "@/lib/prisma";

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (session) {
      // Set user offline in database
      await prisma.user.update({
        where: { id: session.userId },
        data: { isOnline: false },
      });

      // Log activity
      await prisma.activityLog.create({
        data: {
          userId: session.userId,
          activity: `Logged out as ${session.role}`,
          ipAddress: req.headers.get("x-forwarded-for") || "unknown",
        },
      });

      // Broadcast activity to admin
      try {
        const { pusherServer } = await import("@/lib/pusher");
        await pusherServer.trigger("admin-dashboard", "activity", {
          type: "logout",
          userId: session.userId,
          fullName: session.fullName,
          role: session.role,
          activity: `Logged out as ${session.role}`,
          timestamp: new Date().toISOString(),
        });
      } catch (pusherErr) {
        console.error("Pusher logout broadcast error:", pusherErr);
      }
    }

    await clearSession();
    return NextResponse.json({ success: true, message: "Logged out" });
  } catch (error) {
    console.error("Logout error:", error);
    return NextResponse.json(
      { error: "Failed to logout" },
      { status: 500 }
    );
  }
}
