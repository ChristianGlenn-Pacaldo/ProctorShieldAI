import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session || session.role !== "student") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { studentQuizId } = await req.json();

    if (!studentQuizId) {
      return NextResponse.json({ error: "Missing studentQuizId" }, { status: 400 });
    }

    const studentQuiz = await prisma.studentQuiz.findUnique({
      where: { id: studentQuizId },
      include: { quiz: true, student: true },
    });

    if (!studentQuiz || studentQuiz.studentId !== session.userId) {
      return NextResponse.json({ error: "Not found or unauthorized" }, { status: 404 });
    }

    if (studentQuiz.quizStatus === "pending_retake") {
      return NextResponse.json({ error: "Retake already requested" }, { status: 400 });
    }

    // Update status to pending_retake
    await prisma.studentQuiz.update({
      where: { id: studentQuizId },
      data: { quizStatus: "pending_retake" },
    });

    // Notify the teacher via Pusher
    try {
      const { pusherServer } = await import("@/lib/pusher");
      await pusherServer.trigger(`teacher-${studentQuiz.quiz.teacherId}`, "retake-request", {
        studentQuizId: studentQuiz.id,
        studentName: studentQuiz.student.fullName,
        quizTitle: studentQuiz.quiz.title,
        quizId: studentQuiz.quiz.id,
      });
    } catch (e) {
      console.error("Failed to trigger retake request push event:", e);
    }

    return NextResponse.json({ success: true, message: "Retake requested successfully" });
  } catch (error) {
    console.error("Retake request error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
