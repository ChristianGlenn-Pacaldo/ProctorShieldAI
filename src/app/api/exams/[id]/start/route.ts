import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session || session.role !== "teacher") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const examId = parseInt(id);

    const exam = await prisma.exam.findUnique({
      where: { id: examId },
    });

    if (!exam || exam.teacherId !== session.userId) {
      return NextResponse.json({ error: "Exam not found or unauthorized" }, { status: 404 });
    }

    if (exam.examStatus !== "active") {
      return NextResponse.json({ error: "Exam is not in a startable state" }, { status: 400 });
    }

    // Update exam status to in_progress
    await prisma.exam.update({
      where: { id: examId },
      data: { examStatus: "in_progress" },
    });

    // Notify all students in the lobby
    try {
      const { pusherServer } = await import("@/lib/pusher");
      await pusherServer.trigger(`exam-${examId}`, "exam-started", {
        message: "Exam has started!",
      });
    } catch (e) {
      console.error("Failed to trigger exam start push event:", e);
    }

    return NextResponse.json({ success: true, message: "Exam started successfully" });
  } catch (error) {
    console.error("Start exam error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
