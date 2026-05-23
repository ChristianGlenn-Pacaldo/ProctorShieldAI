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

    const { examId, violationType, confidenceScore, snapshot } = await req.json();

    if (!examId || !violationType) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Get the studentExam record
    const studentExam = await prisma.studentExam.findFirst({
      where: {
        studentId: session.userId,
        examId: Number(examId),
      },
      include: {
        exam: true,
      },
    });

    if (!studentExam) {
      return NextResponse.json({ error: "Exam session not found" }, { status: 404 });
    }

    // Record the violation in the database
    const violation = await prisma.violation.create({
      data: {
        studentExamId: studentExam.id,
        violationType: violationType,
        confidenceScore: confidenceScore || 100,
        timestamp: new Date(),
        durationSeconds: 5,
        screenshotPath: snapshot || null,
      },
    });

    // Broadcast the violation to the teacher via Pusher
    // We use the teacher's ID as the channel name so the teacher receives alerts for all their exams
    const channelName = `teacher-${studentExam.exam.teacherId}`;
    
    await pusherServer.trigger(channelName, "new-violation", {
      studentName: session.fullName,
      examTitle: studentExam.exam.title,
      violationType: violationType,
      timestamp: violation.timestamp,
    });

    return NextResponse.json({ success: true, violation });

  } catch (error) {
    console.error("Record violation error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
