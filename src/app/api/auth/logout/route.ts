import { NextRequest, NextResponse } from "next/server";
import { clearSession, getSession } from "@/lib/auth";
import prisma from "@/lib/prisma";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const requestedRole = typeof body.role === "string" ? body.role.toLowerCase() : undefined;
    const roleHint = requestedRole && ["admin", "teacher", "student"].includes(requestedRole)
      ? requestedRole
      : undefined;
    const session = await getSession(roleHint);

    if (session) {
      // Logout must only end the browser session. Account, quiz, payment, and
      // subscription records are durable data and must survive future logins.
      try {
        await prisma.$transaction([
          prisma.user.update({
            where: { id: session.userId },
            data: { isOnline: false, lastSeenAt: new Date() },
          }),
          prisma.activityLog.create({
            data: {
              userId: session.userId,
              activity: `Logged out as ${session.role}`,
              ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown",
            },
          }),
        ]);
      } catch (databaseError) {
        // A logging failure must not trap the user in an authenticated session.
        console.error("Logout activity update error:", databaseError);
      }

      try {
        const { pusherServer } = await import("@/lib/pusher");
        await pusherServer.trigger("private-admin-dashboard", "activity", {
          type: "logout",
          userId: session.userId,
          fullName: session.fullName,
          role: session.role,
          activity: `Logged out as ${session.role}`,
          timestamp: new Date().toISOString(),
        });
      } catch (pusherError) {
        console.error("Pusher logout broadcast error:", pusherError);
      }
    }

    await clearSession(session?.role ?? roleHint);
    return NextResponse.json({ success: true, message: "Logged out" });
  } catch (error) {
    console.error("Logout error:", error);
    await clearSession();
    return NextResponse.json({ success: true, message: "Logged out" });
  }
}
