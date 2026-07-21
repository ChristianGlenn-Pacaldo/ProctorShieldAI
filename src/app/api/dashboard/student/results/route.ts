import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";

export async function GET() {
  try {
    const session = await getSession();
    if (!session || session.role !== "student") {
      return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
    }

    const results = await prisma.studentQuiz.findMany({
      where: {
        studentId: session.userId,
      },
      include: {
        quiz: true,
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

    const quizzes = await prisma.studentQuiz.findMany({
      where: { studentId: session.userId },
      select: { id: true }
    });
    const quizIds = quizzes.map(e => e.id);

    if (quizIds.length > 0) {
      const violations = await prisma.violation.findMany({
        where: { studentQuizId: { in: quizIds } },
        select: { id: true }
      });
      const violationIds = violations.map(v => v.id);
      
      if (violationIds.length > 0) {
        await prisma.evidenceFile.deleteMany({ where: { violationId: { in: violationIds } } });
      }

      await prisma.answer.deleteMany({ where: { studentQuizId: { in: quizIds } } });
      await prisma.violation.deleteMany({ where: { studentQuizId: { in: quizIds } } });
      await prisma.aiAnalysis.deleteMany({ where: { studentQuizId: { in: quizIds } } });
      await prisma.studentQuiz.deleteMany({ where: { id: { in: quizIds } } });
    }

    return NextResponse.json({ success: true, message: "History cleared successfully" });
  } catch (error) {
    console.error("Error clearing results:", error);
    return NextResponse.json({ success: false, message: "Internal server error" }, { status: 500 });
  }
}
