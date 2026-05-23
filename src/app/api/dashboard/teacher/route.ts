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

    // 1. Count total exams created by the teacher
    const totalExams = await prisma.exam.count({
      where: { teacherId },
    });

    // 2. Fetch all student exam sessions for the exams of this teacher
    const studentExams = await prisma.studentExam.findMany({
      where: {
        exam: {
          teacherId,
        },
      },
      include: {
        student: {
          select: {
            fullName: true,
          },
        },
        exam: {
          select: {
            title: true,
          },
        },
        violations: {
          select: {
            violationType: true,
            timestamp: true,
          },
        },
      },
    });

    // 3. Compute stats
    const uniqueStudentIds = new Set(studentExams.map((se) => se.studentId));
    const studentsMonitored = uniqueStudentIds.size;

    const totalViolations = studentExams.reduce((sum, se) => sum + se.violations.length, 0);

    const flaggedStudentsCount = studentExams.filter((se) => {
      const prob = se.cheatingProbability ? Number(se.cheatingProbability) : 0;
      return (
        se.aiVerdict === "cheated" ||
        se.aiVerdict === "suspicious" ||
        prob > 50
      );
    }).length;

    // 4. Compute violations breakdown
    const violationCounts: Record<string, number> = {
      "Tab Switching": 0,
      "No Face Detected": 0,
      "Multiple Faces": 0,
      "Looking Away": 0,
      "Device Detected": 0,
      "Screenshot/Copy": 0,
    };

    studentExams.forEach((se) => {
      se.violations.forEach((v) => {
        const type = v.violationType || "";
        if (type === "tab_switch" || type === "tab_switching") {
          violationCounts["Tab Switching"]++;
        } else if (type === "no_face") {
          violationCounts["No Face Detected"]++;
        } else if (type === "multiple_faces") {
          violationCounts["Multiple Faces"]++;
        } else if (type === "looking_away") {
          violationCounts["Looking Away"]++;
        } else if (type === "device_detected" || type === "phone_detected") {
          violationCounts["Device Detected"]++;
        } else if (type === "attempted_screenshot") {
          violationCounts["Screenshot/Copy"]++;
        }
      });
    });

    const maxCount = Math.max(...Object.values(violationCounts), 1);
    const colors = {
      "Tab Switching": "bg-red-500",
      "No Face Detected": "bg-amber-500",
      "Multiple Faces": "bg-violet-500",
      "Looking Away": "bg-indigo-500",
      "Device Detected": "bg-cyan-500",
      "Screenshot/Copy": "bg-rose-500",
    };

    const violationsBreakdown = Object.entries(violationCounts).map(([type, count]) => ({
      type,
      count,
      pct: Math.round((count / maxCount) * 100),
      color: colors[type as keyof typeof colors] || "bg-gray-500",
    }));

    // 5. Build recent verdicts
    const recentVerdicts = studentExams
      .filter((se) => se.examStatus === "completed")
      .sort((a, b) => {
        const timeA = new Date(a.endTime || a.createdAt).getTime();
        const timeB = new Date(b.endTime || b.createdAt).getTime();
        return timeB - timeA;
      })
      .slice(0, 10)
      .map((se) => {
        const counts: Record<string, number> = {};
        se.violations.forEach((v) => {
          const type = v.violationType || "Violation";
          const shortType =
            type === "tab_switch" || type === "tab_switching"
              ? "Tab"
              : type === "no_face"
              ? "No Face"
              : type === "multiple_faces"
              ? "Multi-face"
              : type === "looking_away"
              ? "Look Away"
              : type === "device_detected" || type === "phone_detected"
              ? "Device"
              : type === "attempted_screenshot"
              ? "Screenshot"
              : type;
          counts[shortType] = (counts[shortType] || 0) + 1;
        });

        const violationSummaryList = Object.entries(counts).map(
          ([type, count]) => `${type} ×${count}`
        );

        let verdictText = "✓ Clean";
        let verdictClass = "bg-emerald-500/15 text-emerald-600";
        if (se.aiVerdict === "cheated") {
          verdictText = `🚫 Cheated (${se.cheatingProbability}%)`;
          verdictClass = "bg-red-500/15 text-red-500";
        } else if (se.aiVerdict === "suspicious") {
          verdictText = `⚠ Suspicious (${se.cheatingProbability}%)`;
          verdictClass = "bg-amber-500/15 text-amber-500";
        } else if (se.aiVerdict === "clean") {
          verdictText = `✓ Clean (${se.cheatingProbability}%)`;
          verdictClass = "bg-emerald-500/15 text-emerald-600";
        }

        return {
          name: se.student.fullName,
          exam: se.exam.title,
          violations: violationSummaryList,
          verdict: verdictText,
          verdictClass,
          score: se.score !== null ? `${Number(se.score)}%` : "100%",
        };
      });

    return NextResponse.json({
      success: true,
      stats: {
        totalExams,
        studentsMonitored,
        totalViolations,
        flaggedStudents: flaggedStudentsCount,
      },
      violationsBreakdown,
      recentVerdicts,
    });
  } catch (error) {
    console.error("Fetch teacher dashboard stats error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
