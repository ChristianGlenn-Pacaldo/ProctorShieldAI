import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";

export async function DELETE(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session || session.role !== "student") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get all student quizzes
    const studentQuizzes = await prisma.studentQuiz.findMany({
      where: { studentId: session.userId },
      select: { id: true }
    });

    const studentQuizIds = studentQuizzes.map(sq => sq.id);

    if (studentQuizIds.length > 0) {
      // Manually delete related records first because Cascade isn't enabled on all
      await prisma.answer.deleteMany({ where: { studentQuizId: { in: studentQuizIds } } });
      await prisma.aiAnalysis.deleteMany({ where: { studentQuizId: { in: studentQuizIds } } });
      
      const violations = await prisma.violation.findMany({
        where: { studentQuizId: { in: studentQuizIds } },
        select: { id: true }
      });
      const violationIds = violations.map(v => v.id);
      
      if (violationIds.length > 0) {
        await prisma.evidenceFile.deleteMany({ where: { violationId: { in: violationIds } } });
        await prisma.violation.deleteMany({ where: { studentQuizId: { in: studentQuizIds } } });
      }

      // Finally delete the student quizzes
      await prisma.studentQuiz.deleteMany({
        where: { studentId: session.userId }
      });
    }

    return NextResponse.json({ success: true, message: "History cleared" });
  } catch (error) {
    console.error("Clear history error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
