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

    const { examId } = await req.json();

    if (!examId) {
      return NextResponse.json({ error: "Missing examId" }, { status: 400 });
    }

    // Find the exam to get the teacherId
    const exam = await prisma.exam.findUnique({
      where: { id: Number(examId) },
    });

    if (!exam) {
      return NextResponse.json({ error: "Exam not found" }, { status: 404 });
    }

    // Broadcast lightweight "student-joined" event to the teacher's channel
    // NO snapshot data here — snapshots go through /api/live/snapshot instead
    const channelName = `teacher-${exam.teacherId}`;

    await pusherServer.trigger(channelName, "student-joined", {
      studentId: session.userId,
      studentName: session.fullName,
      examId: exam.id,
      examTitle: exam.title,
      timestamp: new Date().toISOString(),
    });

    return NextResponse.json({ success: true, teacherId: exam.teacherId });
  } catch (error) {
    console.error("Live join error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
