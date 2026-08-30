import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session || session.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const violations = await prisma.violation.findMany({
      orderBy: { timestamp: "desc" },
      take: 100,
      include: {
        studentQuiz: {
          include: {
            student: { select: { fullName: true } },
            quiz: { select: { title: true } },
          },
        },
      },
    });

    const formatted = violations.map((v) => {
      const vType = v.violationType || "unknown";
      let severity = "Low";
      let severityClass = "bg-blue-500/15 text-blue-600";
      let rowBg = "";

      if (["device_detected", "multiple_faces", "cheated"].includes(vType)) {
        severity = "High";
        severityClass = "bg-rose-500/15 text-rose-600";
        rowBg = "bg-rose-50 dark:bg-rose-500/5";
      } else if (["no_face", "tab_switch", "audio_anomaly", "looking_right", "looking_left", "looking_up", "looking_down"].includes(vType)) {
        severity = "Medium";
        severityClass = "bg-amber-500/15 text-amber-600";
        rowBg = "bg-amber-50 dark:bg-amber-500/5";
      }

      const eventLabel = vType
        .split("_")
        .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");

      return {
        id: v.id.toString(),
        timestamp: new Date(v.timestamp).toLocaleString("en-US", {
          month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
        }),
        event: eventLabel,
        severity,
        severityClass,
        rowBg,
        student: v.studentQuiz?.student?.fullName || "Unknown",
        quiz: v.studentQuiz?.quiz?.title || "Unknown Quiz",
        confidence: v.confidenceScore ? `${v.confidenceScore}%` : "—",
      };
    });

    return NextResponse.json({ success: true, logs: formatted, total: formatted.length });
  } catch (error: unknown) {
    console.error("Admin logs error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
