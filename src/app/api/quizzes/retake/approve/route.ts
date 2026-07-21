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
      return NextResponse.json({ error: "Not found or unauthorized" }, { status: 404 });
    }

    if (action === "accept") {
      // 1. Delete all previous answers
      await prisma.answer.deleteMany({
        where: { studentQuizId: studentQuizId },
      });

      // 2. Delete all previous violations
      await prisma.violation.deleteMany({
        where: { studentQuizId: studentQuizId },
      });

      // 3. Delete previous AI analysis if it exists
      await prisma.aiAnalysis.deleteMany({
        where: { studentQuizId: studentQuizId },
      });

      // 4. Reset the student quiz status so they can take it again
      await prisma.studentQuiz.update({
        where: { id: studentQuizId },
        data: {
          quizStatus: "enrolled",
          score: null,
          aiVerdict: null,
          cheatingProbability: null,
          startTime: null,
          endTime: null,
        },
      });
    } else {
      // Rejecting the retake request means it stays ended
      await prisma.studentQuiz.update({
        where: { id: studentQuizId },
        data: {
          quizStatus: "ended",
        },
      });
    }

    // Notify student of the decision
    try {
      const { pusherServer } = await import("@/lib/pusher");
      await pusherServer.trigger(`student-${studentQuiz.studentId}`, "retake-decision", {
        quizId: studentQuiz.quizId,
        action: action
      });
    } catch (e) {
      console.error("Failed to trigger retake decision push event:", e);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Retake approval error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
