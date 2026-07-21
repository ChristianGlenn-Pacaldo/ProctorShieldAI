import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { pusherServer } from "@/lib/pusher";
import { logDebug } from "@/lib/debug-logger";

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    logDebug(`POST /api/live/join: session=${JSON.stringify(session)}`);
    if (!session || session.role !== "student") {
      logDebug(`POST /api/live/join: Unauthorized role=${session?.role}`);
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { quizId } = await req.json();

    if (!quizId) {
      return NextResponse.json({ error: "Missing quizId" }, { status: 400 });
    }

    // Find the quiz to get the teacherId
    const quiz = await prisma.quiz.findUnique({
      where: { id: Number(quizId) },
    });

    if (!quiz) {
      return NextResponse.json({ error: "Quiz not found" }, { status: 404 });
    }

    // Broadcast lightweight "student-joined" event to the teacher's channel
    // NO snapshot data here — snapshots go through /api/live/snapshot instead
    const channelName = `teacher-${quiz.teacherId}`;

    await pusherServer.trigger(channelName, "student-joined", {
      studentId: session.userId,
      studentName: session.fullName,
      quizId: quiz.id,
      quizTitle: quiz.title,
      timestamp: new Date().toISOString(),
    });

    // Broadcast student-joined event to admin
    try {
      await pusherServer.trigger("admin-dashboard", "activity", {
        type: "quiz-join",
        userId: session.userId,
        fullName: session.fullName,
        role: "student",
        activity: `${session.fullName} joined quiz: ${quiz.title}`,
        timestamp: new Date().toISOString(),
      });
    } catch (e) {
      console.error("Failed to broadcast join to admin:", e);
      logDebug(`POST /api/live/join: Pusher admin broadcast error: ${e}`);
    }

    logDebug(`POST /api/live/join: Student ${session.fullName} successfully joined quiz ${quiz.title}`);
    return NextResponse.json({ success: true, teacherId: quiz.teacherId });
  } catch (error) {
    console.error("Live join error:", error);
    logDebug(`POST /api/live/join ERROR: ${error}`);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
