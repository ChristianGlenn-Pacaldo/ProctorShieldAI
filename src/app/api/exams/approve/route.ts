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
      return NextResponse.json({ error: "Student exam not found or unauthorized" }, { status: 404 });
    }

    if (studentExam.examStatus !== "pending_approval") {
      return NextResponse.json({ error: "Student is not pending approval" }, { status: 400 });
    }

    const newStatus = action === "accept" ? "enrolled" : "rejected";

    await prisma.studentExam.update({
      where: { id: studentExamId },
      data: { examStatus: newStatus },
    });

    // Notify the specific student
    try {
      const { pusherServer } = await import("@/lib/pusher");
      await pusherServer.trigger(`student-${studentExam.studentId}`, "approval-status", {
        status: newStatus,
        examId: studentExam.examId,
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
