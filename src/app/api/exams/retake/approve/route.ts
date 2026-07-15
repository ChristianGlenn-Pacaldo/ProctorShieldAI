import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session || session.role !== "teacher") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { studentExamId, action } = await req.json();

    if (!studentExamId || !["accept", "reject"].includes(action)) {
      return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });
    }

    const studentExam = await prisma.studentExam.findUnique({
      where: { id: studentExamId },
      include: { exam: true },
    });

    if (!studentExam || studentExam.exam.teacherId !== session.userId) {
      return NextResponse.json({ error: "Not found or unauthorized" }, { status: 404 });
    }

    if (action === "accept") {
      // 1. Delete all previous answers
      await prisma.studentAnswer.deleteMany({
        where: { studentExamId: studentExamId },
      });

      // 2. Delete all previous violations
      await prisma.studentViolation.deleteMany({
        where: { studentExamId: studentExamId },
      });

      // 3. Reset the student exam status so they can take it again
      await prisma.studentExam.update({
        where: { id: studentExamId },
        data: {
          examStatus: "enrolled",
          score: null,
          aiVerdict: null,
          aiAnalysis: null,
          submittedAt: null,
          endedAt: null,
        },
      });
    } else {
      // Rejecting the retake request means it stays ended
      await prisma.studentExam.update({
        where: { id: studentExamId },
        data: {
          examStatus: "ended",
        },
      });
    }

    // Notify student of the decision
    try {
      const { pusherServer } = await import("@/lib/pusher");
      await pusherServer.trigger(`student-${studentExam.studentId}`, "retake-decision", {
        examId: studentExam.examId,
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
