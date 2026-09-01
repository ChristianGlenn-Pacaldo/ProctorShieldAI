import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session || session.role !== "teacher") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { studentQuizId, action } = await req.json();

    if (!studentQuizId || !["accept", "reject"].includes(action)) {
      return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });
    }

    const studentQuiz = await prisma.studentQuiz.findUnique({
      where: { id: studentQuizId },
      include: { quiz: true },
    });

    if (!studentQuiz || studentQuiz.quiz.teacherId !== session.userId) {
      return NextResponse.json({ error: "Student quiz not found or unauthorized" }, { status: 404 });
    }

    if (studentQuiz.quizStatus !== "pending_approval") {
      return NextResponse.json({ error: "Student is not pending approval" }, { status: 400 });
    }

    const newStatus = action === "accept" ? "in_progress" : "rejected";

    await prisma.studentQuiz.update({
      where: { id: studentQuizId },
      data: {
        quizStatus: newStatus,
        startTime: action === "accept" ? new Date() : studentQuiz.startTime,
      },
    });

    // Notify the specific student
    try {
      const { pusherServer } = await import("@/lib/pusher");
      await pusherServer.trigger(`private-student-${studentQuiz.studentId}`, "approval-status", {
        status: newStatus,
        quizId: studentQuiz.quizId,
      });
    } catch (e) {
      console.error("Failed to trigger approval push event:", e);
    }

    return NextResponse.json({ success: true, message: `Student ${action}ed successfully` });
  } catch (error) {
    console.error("Approve student error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
