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

    // Fetch violations for exams created by this teacher
    const violations = await prisma.violation.findMany({
      where: {
        studentExam: {
          exam: {
            teacherId: teacherId,
          },
        },
      },
      include: {
        studentExam: {
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
          },
        },
      },
      orderBy: {
        timestamp: "desc",
      },
    });

    const formattedEvidence = violations.map((v) => {
      const typeMapping: Record<string, string> = {
        tab_switch: "Tab Switch",
        tab_switching: "Tab Switch",
        no_face: "No Face Detected",
        multiple_faces: "Multiple Faces",
        looking_away: "Looking Away",
        device_detected: "Device Detected",
        phone_detected: "Device Detected",
        attempted_screenshot: "Screenshot/Copy",
        audio_anomaly: "Audio Anomaly",
        window_resize: "Window Resized",
      };

      const displayType = typeMapping[v.violationType || ""] || "Violation";
      
      const dateObj = new Date(v.timestamp);
      const formattedTime = dateObj.toLocaleTimeString([], { 
        hour: "2-digit", 
        minute: "2-digit", 
        second: "2-digit", 
        hour12: false 
      });

      // Determine severity indicators
      let bg = "bg-red-50 dark:bg-red-500/5 border-l-2 border-red-500";
      let btnClass = "bg-red-500 text-white hover:bg-red-600";
      
      if (v.violationType === "looking_away" || v.violationType === "tab_switch" || v.violationType === "window_resize") {
        bg = "bg-amber-50 dark:bg-amber-500/5 border-l-2 border-amber-500";
        btnClass = "bg-amber-500 text-white hover:bg-amber-600";
      } else if (v.violationType === "audio_anomaly") {
        bg = "bg-orange-50 dark:bg-orange-500/5 border-l-2 border-orange-500";
        btnClass = "bg-orange-500 text-white hover:bg-orange-600";
      }

      return {
        id: v.id.toString(),
        name: v.studentExam.student.fullName,
        examTitle: v.studentExam.exam.title,
        event: `${displayType} · ${formattedTime}`,
        violationType: v.violationType,
        timestamp: v.timestamp,
        bg,
        btnClass,
        screenshotPath: v.screenshotPath || null,
      };
    });

    return NextResponse.json({ success: true, evidence: formattedEvidence });
  } catch (error) {
    console.error("Fetch evidence logs error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
