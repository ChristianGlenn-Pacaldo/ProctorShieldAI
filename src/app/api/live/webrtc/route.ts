import { NextRequest, NextResponse } from "next/server";
import { pusherServer } from "@/lib/pusher";
import { getSession } from "@/lib/auth";
import prisma from "@/lib/prisma";

const SIGNAL_TYPES = new Set([
  "request-stream",
  "teacher-ready",
  "student-ready",
  "sdp-offer",
  "sdp-answer",
  "ice-candidate",
]);

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { targetChannel, signalType, data } = await req.json();
    const quizId = Number(data?.quizId);
    if (
      typeof targetChannel !== "string" ||
      !SIGNAL_TYPES.has(signalType) ||
      !Number.isInteger(quizId) ||
      JSON.stringify(data).length > 100_000
    ) {
      return NextResponse.json({ error: "Invalid signaling payload" }, { status: 400 });
    }

    let allowed = false;
    if (session.role === "student") {
      const enrollment = await prisma.studentQuiz.findFirst({
        where: { studentId: session.userId, quizId },
        select: { quiz: { select: { teacherId: true } } },
      });
      allowed = Boolean(
        enrollment && targetChannel === `private-teacher-${enrollment.quiz.teacherId}`
      );
    } else if (session.role === "teacher") {
      const target = /^private-student-(.+)$/.exec(targetChannel)?.[1];
      if (target) {
        allowed = Boolean(await prisma.studentQuiz.findFirst({
          where: { studentId: target, quizId, quiz: { teacherId: session.userId } },
          select: { id: true },
        }));
      }
    }

    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    await pusherServer.trigger(targetChannel, "webrtc-signal", {
      senderId: session.userId,
      senderName: session.fullName,
      senderRole: session.role,
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
