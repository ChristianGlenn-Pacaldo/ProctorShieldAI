import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session || session.role !== "teacher") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const teacherId = session.userId;

    // Fetch all student exam sessions for this teacher
    const studentExams = await prisma.studentExam.findMany({
      where: {
        exam: {
          teacherId: teacherId,
        },
      },
      include: {
        violations: true,
      },
    });

    let clean = 0;
    let suspicious = 0;
    let highRisk = 0;

    studentExams.forEach((se) => {
      const vCount = se.violations.length;
      if (vCount === 0) {
        clean++;
      } else if (vCount <= 2) {
        suspicious++;
      } else {
        highRisk++;
      }
    });

    const total = clean + suspicious + highRisk;

    const data = [
      {
        label: "✓ Clean (Trust > 90%)",
        value: clean,
        pct: total > 0 ? Math.round((clean / total) * 100) : 0,
        color: "bg-emerald-500",
      },
      {
        label: "⚠ Suspicious (70-90%)",
        value: suspicious,
        pct: total > 0 ? Math.round((suspicious / total) * 100) : 0,
        color: "bg-amber-500",
      },
      {
        label: "🚫 High Risk (< 70%)",
        value: highRisk,
        pct: total > 0 ? Math.round((highRisk / total) * 100) : 0,
        color: "bg-red-500",
      },
    ];

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error("Fetch reports error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
