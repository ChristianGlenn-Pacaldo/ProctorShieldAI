import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { expireSubscriptions } from "@/lib/maintenance";
import { hasActiveProSubscription } from "@/lib/teacher-entitlements";
import { getViolationLabel } from "@/lib/proctoring-detection";
import { EvidenceWithinRetentionError, requestTeacherEvidencePurge } from "@/lib/evidence-retention";

const PAGE_SIZE = 25;

async function requireEvidenceAccess(userId: string) {
  await expireSubscriptions(userId);
  return hasActiveProSubscription(userId);
}

export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session || session.role !== "teacher") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!await requireEvidenceAccess(session.userId)) {
      return NextResponse.json(
        { error: "Evidence Replay requires an active Pro subscription", code: "SUBSCRIPTION_REQUIRED" },
        { status: 403 },
      );
    }
    const teacherId = session.userId;
    const requestedPage = Number(new URL(req.url).searchParams.get("page") ?? "1");
    if (!Number.isSafeInteger(requestedPage) || requestedPage < 1) {
      return NextResponse.json({ error: "Invalid page" }, { status: 400 });
    }

    const where = {
      studentQuiz: {
        quiz: {
          teacherId,
        },
      },
    };
    const total = await prisma.violation.count({ where });
    const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const page = Math.min(requestedPage, pageCount);
    const violations = await prisma.violation.findMany({
      where,
      include: {
        evidenceFiles: {
          where: { deletionRequestedAt: null, deletedAt: null },
          orderBy: { uploadedAt: "desc" },
          take: 1,
        },
        studentQuiz: {
          include: {
            student: {
              select: {
                fullName: true,
              },
            },
            quiz: {
              select: {
                title: true,
              },
            },
          },
        },
      },
      orderBy: [{ timestamp: "desc" }, { id: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    });

    const formattedEvidence = violations.map((v) => {
      const primaryEvidence = v.evidenceFiles[0];
      const legacyTypeMapping: Record<string, string> = {
        tab_switching: "App/tab switch or window minimized",
        phone_detected: "Unauthorized phone/device detected",
        window_resize: "Window resized",
      };
      const displayType = legacyTypeMapping[v.violationType || ""]
        || (v.violationType ? getViolationLabel(v.violationType) : "Violation");
      
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
        name: v.studentQuiz.student.fullName,
        quizTitle: v.studentQuiz.quiz.title,
        event: `${displayType} · ${formattedTime}`,
        violationType: v.violationType,
        timestamp: v.timestamp,
        bg,
        btnClass,
        screenshotPath: primaryEvidence ? `/api/evidence/${v.id}` : v.screenshotPath || null,
        evidenceType: primaryEvidence?.fileType
          || (/^data:([^;]+);base64,/.exec(v.screenshotPath || "")?.[1] ?? null),
        durationSeconds: v.durationSeconds,
      };
    });

    return NextResponse.json({ success: true, evidence: formattedEvidence, total, page, pageSize: PAGE_SIZE });
  } catch (error) {
    console.error("Fetch evidence logs error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const session = await getSession();
    if (!session || session.role !== "teacher") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const result = await requestTeacherEvidencePurge(session.userId);
    return NextResponse.json({
      success: true,
      ...result,
      message: `${result.queuedEvidenceFiles} expired evidence files queued for storage deletion; violation history is retained.`,
    }, { status: 202 });
  } catch (error) {
    if (error instanceof EvidenceWithinRetentionError) {
      return NextResponse.json(
        { error: error.message, code: "EVIDENCE_RETENTION_ACTIVE", retentionDays: error.retentionDays },
        { status: 409 },
      );
    }
    console.error("Clear evidence logs error:", error);
    return NextResponse.json({ error: "Failed to queue evidence deletion" }, { status: 500 });
  }
}
