import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session || session.role !== "student") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { studentExamId } = await req.json();

    if (!studentExamId) {
      return NextResponse.json({ error: "Missing studentExamId" }, { status: 400 });
    }

    const studentExam = await prisma.studentExam.findUnique({
      where: { id: studentExamId },
      include: { exam: true, student: true },
    });

    if (!studentExam || studentExam.studentId !== session.userId) {
      return NextResponse.json({ error: "Not found or unauthorized" }, { status: 404 });
    }

    if (studentExam.examStatus === "pending_retake") {
      return NextResponse.json({ error: "Retake already requested" }, { status: 400 });
    }

    // Update status to pending_retake
    await prisma.studentExam.update({
      where: { id: studentExamId },
      data: { examStatus: "pending_retake" },
    });

    // Notify the teacher via Pusher
    try {
      const { pusherServer } = await import("@/lib/pusher");
      await pusherServer.trigger(`teacher-${studentExam.exam.teacherId}`, "retake-request", {
        studentExamId: studentExam.id,
        studentName: studentExam.student.fullName,
        examTitle: studentExam.exam.title,
        examId: studentExam.exam.id,
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
