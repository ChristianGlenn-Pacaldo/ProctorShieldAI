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
    const quizId = parseInt(id);

    const quiz = await prisma.quiz.findUnique({
      where: { id: quizId },
    });

    if (!quiz || quiz.teacherId !== session.userId) {
      return NextResponse.json({ error: "Quiz not found or unauthorized" }, { status: 404 });
    }

    if (quiz.quizStatus !== "active") {
      return NextResponse.json({ error: "Quiz is not in a startable state" }, { status: 400 });
    }

    const startedAt = new Date();
    await prisma.$transaction([
      prisma.quiz.update({
        where: { id: quizId },
        data: { quizStatus: "in_progress" },
      }),
      prisma.studentQuiz.updateMany({
        where: { quizId, quizStatus: "enrolled" },
        data: { quizStatus: "in_progress", startTime: startedAt },
      }),
    ]);

    // Notify all students in the lobby
    try {
      const { pusherServer } = await import("@/lib/pusher");
      await pusherServer.trigger(`private-quiz-${quizId}`, "quiz-started", {
        message: "Quiz has started!",
      });
    } catch (e) {
      console.error("Failed to trigger quiz start push event:", e);
    }

    return NextResponse.json({ success: true, message: "Quiz started successfully" });
  } catch (error) {
    console.error("Start quiz error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
