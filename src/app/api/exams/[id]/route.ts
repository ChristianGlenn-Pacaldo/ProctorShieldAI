import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session || session.role !== "teacher") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const examId = parseInt(id);
    const body = await req.json();

    const existingExam = await prisma.exam.findUnique({
      where: { id: examId },
    });

    if (!existingExam || existingExam.teacherId !== session.userId) {
      return NextResponse.json({ error: "Exam not found or unauthorized" }, { status: 404 });
    }

    const updatedExam = await prisma.exam.update({
      where: { id: examId },
      data: {
        examStatus: body.examStatus !== undefined ? body.examStatus : existingExam.examStatus,
      },
    });

    return NextResponse.json({ success: true, exam: updatedExam });
  } catch (error) {
    console.error("Update exam error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
