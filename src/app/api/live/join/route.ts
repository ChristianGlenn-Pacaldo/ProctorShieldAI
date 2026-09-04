import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { pusherServer } from "@/lib/pusher";

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session || session.role !== "student") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { quizId } = await req.json();

    if (!quizId) {
      return NextResponse.json({ error: "Missing quizId" }, { status: 400 });
    }

    const enrollment = await prisma.studentQuiz.findFirst({
      where: {
        studentId: session.userId,
        quizId: Number(quizId),
        quizStatus: "in_progress",
        startTime: { not: null },
        endTime: null,
        quiz: { quizStatus: { in: ["in_progress", "ended"] } },
      },
      include: { quiz: true },
      orderBy: { attemptNumber: "desc" },
    });

    if (!enrollment) {
      return NextResponse.json({ error: "Quiz session not found" }, { status: 404 });
    }
    const quiz = enrollment.quiz;

    // Broadcast lightweight "student-joined" event to the teacher's channel
    // NO snapshot data here — snapshots go through /api/live/snapshot instead
    const channelName = `private-teacher-${quiz.teacherId}`;

    await pusherServer.trigger(channelName, "student-joined", {
      studentId: session.userId,
      studentName: session.fullName,
      quizId: quiz.id,
      quizTitle: quiz.title,
      deviceType: enrollment.deviceType === "mobile" ? "mobile" : "desktop",
      monitoringLevel: enrollment.monitoringLevel === "strict" ? "strict" : "reduced",
      connectionStatus: "online",
      timestamp: new Date().toISOString(),
    });

    // Broadcast student-joined event to admin
    try {
      await pusherServer.trigger("private-admin-dashboard", "activity", {
        type: "quiz-join",
        userId: session.userId,
        fullName: session.fullName,
        role: "student",
        activity: `${session.fullName} joined quiz: ${quiz.title}`,
        timestamp: new Date().toISOString(),
      });
    } catch (e) {
      console.error("Failed to broadcast join to admin:", e);
    }

    return NextResponse.json({ success: true, teacherId: quiz.teacherId });
  } catch (error) {
    console.error("Live join error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
