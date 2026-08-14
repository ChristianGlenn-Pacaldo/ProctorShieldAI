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

    const { quizId, violationType, confidenceScore, snapshot } = await req.json();

    if (!quizId || !violationType) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Get the studentQuiz record
    const studentQuiz = await prisma.studentQuiz.findFirst({
      where: {
        studentId: session.userId,
        quizId: Number(quizId),
      },
      include: {
        quiz: true,
      },
    });

    if (!studentQuiz) {
      return NextResponse.json({ error: "Quiz session not found" }, { status: 404 });
    }

    // Record the violation in the database
    const violation = await prisma.violation.create({
      data: {
        studentQuizId: studentQuiz.id,
        violationType: violationType,
        confidenceScore: confidenceScore || 100,
        timestamp: new Date(),
        durationSeconds: 5,
        screenshotPath: snapshot || null,
      },
    });

    // Broadcast the violation to the teacher via Pusher
    // We use the teacher's ID as the channel name so the teacher receives alerts for all their quizzes
    const channelName = `teacher-${studentQuiz.quiz.teacherId}`;
    
    await pusherServer.trigger(channelName, "new-violation", {
      studentId: session.userId,
      studentName: session.fullName,
      quizTitle: studentQuiz.quiz.title,
      violationType: violationType,
      timestamp: violation.timestamp,
    });

    // Broadcast violation event to admin
    try {
      await pusherServer.trigger("admin-dashboard", "activity", {
        type: "violation",
        userId: session.userId,
        fullName: session.fullName,
        role: "student",
        activity: `Violation (${violationType}) flagged for ${session.fullName} on ${studentQuiz.quiz.title}`,
        timestamp: violation.timestamp.toISOString(),
      });
    } catch (e) {
      console.error("Failed to broadcast violation to admin:", e);
    }

    return NextResponse.json({ success: true, violation });

  } catch (error) {
    console.error("Record violation error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
