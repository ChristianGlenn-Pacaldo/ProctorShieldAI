import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";

class RetakeConflictError extends Error {}

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
      include: { quiz: true, student: true },
    });

    if (!studentQuiz || studentQuiz.quiz.teacherId !== session.userId) {
      return NextResponse.json({ error: "Not found or unauthorized" }, { status: 404 });
    }
    if (studentQuiz.quizStatus !== "pending_retake" || !studentQuiz.endTime) {
      return NextResponse.json({ error: "This retake request is no longer pending" }, { status: 409 });
    }

    if (action === "accept") {
      // Preserve the completed attempt and its evidence. A retake is a new
      // attempt, not a destructive reset of academic history.
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`retake:${studentQuiz.studentId}:${studentQuiz.quizId}`}))`;
        const claimed = await tx.studentQuiz.updateMany({
          where: { id: studentQuiz.id, quizStatus: "pending_retake", endTime: { not: null } },
          data: { quizStatus: "completed" },
        });
        if (claimed.count !== 1) throw new RetakeConflictError();
        const latest = await tx.studentQuiz.findFirst({
          where: { studentId: studentQuiz.studentId, quizId: studentQuiz.quizId },
          orderBy: { attemptNumber: "desc" },
          select: { attemptNumber: true },
        });
        await tx.studentQuiz.create({
          data: {
            studentId: studentQuiz.studentId,
            quizId: studentQuiz.quizId,
            attemptNumber: (latest?.attemptNumber ?? studentQuiz.attemptNumber) + 1,
            quizStatus: studentQuiz.attemptMode === "arena" ? "in_progress" : "enrolled",
            attemptMode: studentQuiz.attemptMode,
            startTime: studentQuiz.attemptMode === "arena" ? new Date() : null,
          },
        });
      });
    } else {
      const rejected = await prisma.studentQuiz.updateMany({
        where: { id: studentQuizId, quizStatus: "pending_retake", endTime: { not: null } },
        data: { quizStatus: "completed" },
      });
      if (rejected.count !== 1) {
        return NextResponse.json({ error: "This retake request is no longer pending" }, { status: 409 });
      }
    }

    // 1. Create DB Notification for Student
    try {
      await prisma.notification.create({
        data: {
          userId: studentQuiz.studentId,
          title: `Retake Request ${action === "accept" ? "Approved" : "Rejected"}`,
          message: `Your instructor ${action === "accept" ? "approved" : "rejected"} your request to retake "${studentQuiz.quiz.title}".`,
        },
      });
    } catch (nErr) {
      console.error("Failed to create retake decision notification:", nErr);
    }

    // 2. Notify student of the decision via Pusher
    try {
      const { pusherServer } = await import("@/lib/pusher");
      await pusherServer.trigger(`private-student-${studentQuiz.studentId}`, "retake-decision", {
        quizId: studentQuiz.quizId,
        action: action,
      });

      // Trigger notification bell update for student
      await pusherServer.trigger(`private-user-${studentQuiz.studentId}`, "notification", {
        title: `Retake Request ${action === "accept" ? "Approved" : "Rejected"}`,
        message: `Your instructor ${action === "accept" ? "approved" : "rejected"} your request to retake "${studentQuiz.quiz.title}".`,
      });
    } catch (e) {
      console.error("Failed to trigger retake decision push event:", e);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof RetakeConflictError) {
      return NextResponse.json({ error: "This retake request is no longer pending" }, { status: 409 });
    }
    console.error("Retake approval error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
