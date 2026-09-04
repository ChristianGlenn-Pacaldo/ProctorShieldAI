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
      include: {
        questions: { select: { choices: { select: { isCorrect: true } } } },
      },
    });

    if (!quiz || quiz.teacherId !== session.userId) {
      return NextResponse.json({ error: "Quiz not found or unauthorized" }, { status: 404 });
    }

    if (quiz.quizStatus !== "active") {
      return NextResponse.json({ error: "Quiz is not in a startable state" }, { status: 400 });
    }

    if (quiz.questions.length === 0) {
      return NextResponse.json({ error: "Add at least one question before starting the quiz" }, { status: 409 });
    }
    if (quiz.questions.some((question) => (
      question.choices.length < 2
      || question.choices.filter((choice) => choice.isCorrect).length !== 1
    ))) {
      return NextResponse.json(
        { error: "Every question needs at least two choices and exactly one correct answer" },
        { status: 409 },
      );
    }

    const startedAt = new Date();
    const started = await prisma.$transaction(async (tx) => {
      const claimed = await tx.quiz.updateMany({
        where: { id: quizId, teacherId: session.userId, quizStatus: "active" },
        data: { quizStatus: "in_progress" },
      });
      if (claimed.count !== 1) return false;
      await tx.studentQuiz.updateMany({
        where: { quizId, quizStatus: "enrolled" },
        data: { quizStatus: "in_progress", startTime: startedAt },
      });
      return true;
    });
    if (!started) {
      return NextResponse.json({ error: "Quiz was already started or changed" }, { status: 409 });
    }

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
