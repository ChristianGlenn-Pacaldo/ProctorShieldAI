import { NextRequest, NextResponse } from "next/server";
import { pusherServer } from "@/lib/pusher";
import { getSession } from "@/lib/auth";

// POST /api/live/webrtc — Relay WebRTC signaling (offers, answers, ICE candidates)
export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    const { targetUserId, targetChannel, signalType, data } = await req.json();

    if (!targetChannel || !signalType || !data) {
      return NextResponse.json({ error: "Invalid signaling payload" }, { status: 400 });
    }

    const senderId = session?.userId ? String(session.userId) : data.studentId || "unknown";
    const senderName = session?.fullName || data.studentName || "User";
    const senderRole = session?.role || "user";

    // Trigger Pusher event on target channel
    await pusherServer.trigger(targetChannel, "webrtc-signal", {
      senderId,
      senderName,
      senderRole,
      signalType,
      data,
      timestamp: new Date().toISOString(),
    });

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error("WebRTC signaling error:", error);
    return NextResponse.json({ error: "Failed to relay signal" }, { status: 500 });
  }
}
