import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";

// GET /api/notifications — Fetch unread notifications for current user
export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const notifications = await prisma.notification.findMany({
      where: { userId: session.userId },
      orderBy: { createdAt: "desc" },
      take: 20,
    });

    const unreadCount = notifications.filter((n) => !n.isRead).length;

    return NextResponse.json({
      success: true,
      notifications: notifications.map((n) => ({
        id: n.id.toString(),
        title: n.title,
        message: n.message,
        isRead: n.isRead,
        createdAt: n.createdAt.toISOString(),
      })),
      unreadCount,
    });
  } catch (error: unknown) {
    console.error("Notifications GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PUT /api/notifications — Mark all as read for current user
export async function PUT(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await req.json();

    if (id === "all") {
      await prisma.notification.updateMany({
        where: { userId: session.userId, isRead: false },
        data: { isRead: true },
      });
    } else {
      if (typeof id !== "string" || !/^\d+$/.test(id)) {
        return NextResponse.json({ error: "Invalid notification" }, { status: 400 });
      }
      const updated = await prisma.notification.updateMany({
        where: { id: BigInt(id), userId: session.userId },
        data: { isRead: true },
      });
      if (updated.count === 0) {
        return NextResponse.json({ error: "Notification not found" }, { status: 404 });
      }
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error("Notifications PUT error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
