import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";

export async function GET() {
  try {
    const session = await getSession();
    if (!session || session.role !== "student") {
      return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
    }

    const results = await prisma.studentExam.findMany({
      where: {
        studentId: session.userId,
      },
      include: {
        exam: true,
        aiAnalysis: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return NextResponse.json({ success: true, results });
  } catch (error) {
    console.error("Error fetching results:", error);
    return NextResponse.json({ success: false, message: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const session = await getSession();
    if (!session || session.role !== "student") {
      return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
    }

    const exams = await prisma.studentExam.findMany({
      where: { studentId: session.userId },
      select: { id: true }
    });
    const examIds = exams.map(e => e.id);

    if (examIds.length > 0) {
      const violations = await prisma.violation.findMany({
        where: { studentExamId: { in: examIds } },
        select: { id: true }
      });
      const violationIds = violations.map(v => v.id);
      
      if (violationIds.length > 0) {
        await prisma.evidenceFile.deleteMany({ where: { violationId: { in: violationIds } } });
      }

      await prisma.answer.deleteMany({ where: { studentExamId: { in: examIds } } });
      await prisma.violation.deleteMany({ where: { studentExamId: { in: examIds } } });
      await prisma.aiAnalysis.deleteMany({ where: { studentExamId: { in: examIds } } });
      await prisma.studentExam.deleteMany({ where: { id: { in: examIds } } });
    }

    return NextResponse.json({ success: true, message: "History cleared successfully" });
  } catch (error) {
    console.error("Error clearing results:", error);
    return NextResponse.json({ success: false, message: "Internal server error" }, { status: 500 });
  }
}
