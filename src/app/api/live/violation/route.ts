import { withBackupWriteGate } from "@/lib/backup-write-gate";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { pusherServer } from "@/lib/pusher";
import { consumeRateLimitGroup, getClientIp } from "@/lib/security";
import { uploadEvidence } from "@/lib/evidence-storage";
import { VALID_VIOLATION_TYPES } from "@/lib/proctoring-detection";

const validViolationTypes = new Set<string>(VALID_VIOLATION_TYPES);

function isValidSnapshot(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2_800_000) return false;
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || match[2].length % 4 !== 0) return false;
  const bytes = Buffer.from(match[2], "base64");
  // Buffer's decoder is permissive; require canonical base64 and matching media.
  if (bytes.length > 2_000_000 || bytes.toString("base64") !== match[2]) return false;
  if (match[1] === "jpeg") {
    return bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
  }
  if (match[1] === "png") {
    return bytes.length >= 45 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      && bytes.readUInt32BE(8) === 13 && bytes.toString("ascii", 12, 16) === "IHDR"
      && bytes.readUInt32BE(16) > 0 && bytes.readUInt32BE(20) > 0
      && bytes.subarray(-12).equals(Buffer.from([0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]));
  }
  return bytes.length >= 20 && bytes.toString("ascii", 0, 4) === "RIFF"
    && bytes.readUInt32LE(4) === bytes.length - 8 && bytes.toString("ascii", 8, 12) === "WEBP"
    && ["VP8 ", "VP8L", "VP8X"].includes(bytes.toString("ascii", 12, 16));
}

async function POSTImpl(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session || session.role !== "student") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rateLimit = await consumeRateLimitGroup(
      [`violation:user:${session.userId}`, `violation:ip:${getClientIp(req)}`],
      60,
      60_000,
    );
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "Too many violation events" },
        { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
      );
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid violation request body" }, { status: 400 });
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Invalid violation request body" }, { status: 400 });
    }
    const { quizId, studentQuizId, incidentId, violationType, confidenceScore, screenshot, snapshot } = body as Record<string, unknown>;
    if (incidentId != null && (typeof incidentId !== "string" || !/^[a-zA-Z0-9-]{1,64}$/.test(incidentId))) return NextResponse.json({ error: "Invalid incident ID" }, { status: 400 });
    const numericQuizId = typeof quizId === "number" || typeof quizId === "string" ? Number(quizId) : NaN;

    if (!((typeof quizId === "number") || (typeof quizId === "string" && /^\d+$/.test(quizId)))
      || !Number.isInteger(numericQuizId) || numericQuizId < 1 || numericQuizId > 2_147_483_647
      || typeof studentQuizId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(studentQuizId)
      || typeof violationType !== "string" || !validViolationTypes.has(violationType)
      || (confidenceScore != null && ((typeof confidenceScore !== "number" && typeof confidenceScore !== "string")
        || (typeof confidenceScore === "string" && !confidenceScore.trim()) || !Number.isFinite(Number(confidenceScore))))) {
      return NextResponse.json({ error: "Invalid violation event" }, { status: 400 });
    }
    for (const image of [screenshot, snapshot]) {
      if (typeof image === "string" && (image.length > 2_800_000
        || image.length - image.indexOf(",") - 1 > Math.ceil(2_000_000 / 3) * 4)) {
        return NextResponse.json({ error: "Oversized evidence image" }, { status: 413 });
      }
      if (image != null && !isValidSnapshot(image)) {
        return NextResponse.json({ error: "Invalid evidence image" }, { status: 400 });
      }
    }
    const evidence = (screenshot ?? snapshot) as string | null | undefined;

    // Get the studentQuiz record
    const studentQuiz = await prisma.studentQuiz.findFirst({
      where: {
        studentId: session.userId,
        quizId: numericQuizId,
        endTime: null,
        quizStatus: "in_progress",
        startTime: { not: null },
        quiz: { quizMode: { not: "arena" } },
      },
      include: {
        quiz: true,
      },
      orderBy: { attemptNumber: "desc" },
    });

    if (!studentQuiz || studentQuizId !== studentQuiz.id) {
      return NextResponse.json({ error: "Quiz session not found" }, { status: 404 });
    }
    if (studentQuiz.quiz.quizMode === "arena") {
      return NextResponse.json({ error: "Arena quizzes do not use proctoring violations" }, { status: 400 });
    }

    // Serialize violations per attempt. The three-strike contract must be
    // enforced by the server, not only by browser code that can be bypassed.
    const violationResult = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`quiz-violations:${studentQuiz.id}`}))`;
      const active = await tx.studentQuiz.updateMany({
        where: { id: studentQuiz.id, endTime: null, quizStatus: "in_progress" },
        data: { lastHeartbeatAt: new Date() },
      });
      if (active.count !== 1) return { violation: null, count: -1 };
      const incidentKey = incidentId ? `proctored:incident:${studentQuiz.id}:${incidentId}` : null;
      const existingCount = await tx.violation.count({ where: { studentQuizId: studentQuiz.id } });
      if (incidentKey) {
        const recorded = await tx.setting.findUnique({ where: { settingKey: incidentKey } });
        if (recorded?.settingValue) {
          const violation = await tx.violation.findUnique({ where: { id: BigInt(recorded.settingValue) } });
          if (violation) return { violation, count: existingCount, replayed: true };
        }
      }
      if (existingCount >= 3) return { violation: null, count: existingCount };

      const violation = await tx.violation.create({
        data: {
          studentQuizId: studentQuiz.id,
          violationType: violationType,
          confidenceScore: Math.max(0, Math.min(100, Number(confidenceScore) || 100)),
          timestamp: new Date(),
          // A duration is only recorded after a real 3-5 second video is stored.
          durationSeconds: null,
          screenshotPath: null,
        },
      });
      if (incidentKey) await tx.setting.create({ data: { settingKey: incidentKey, settingValue: String(violation.id) } });
      return { violation, count: existingCount + 1, replayed: false };
    });

    if (violationResult.count < 0) return NextResponse.json({ error: "Attempt is already completed" }, { status: 409 });
    if (!violationResult.violation) {
      return NextResponse.json(
        { error: "Violation limit reached", code: "VIOLATION_LIMIT_REACHED", violationCount: 3 },
        { status: 409 },
      );
    }
    const violation = violationResult.violation;
    if (violationResult.replayed) return NextResponse.json({ success: true, violationCount: violationResult.count,
      violation: { id: String(violation.id), studentQuizId: violation.studentQuizId, violationType: violation.violationType, timestamp: violation.timestamp.toISOString() } });

    if (evidence) {
      try {
        const stored = await uploadEvidence(evidence, studentQuiz.id);
        if (stored) {
          await prisma.evidenceFile.create({
            data: {
              violationId: violation.id,
              fileType: stored.contentType,
              filePath: stored.key,
            },
          });
        } else {
          await prisma.violation.update({
            where: { id: violation.id },
            data: { screenshotPath: evidence },
          });
        }
      } catch (error) {
        console.error("Permanent evidence upload failed:", error);
        try {
          await prisma.violation.update({
            where: { id: violation.id },
            data: { screenshotPath: evidence },
          });
        } catch (fallbackError) {
          console.error("Evidence snapshot fallback failed:", fallbackError);
        }
      }
    }

    // Broadcast the violation to the teacher via Pusher
    // We use the teacher's ID as the channel name so the teacher receives alerts for all their quizzes
    const channelName = `private-teacher-${studentQuiz.quiz.teacherId}`;
    
    await pusherServer.trigger(channelName, "new-violation", {
      studentId: session.userId,
      studentName: session.fullName,
      quizTitle: studentQuiz.quiz.title,
      violationType,
      violationCount: violationResult.count,
      snapshot: evidence || null,
      timestamp: violation.timestamp,
      quizId: studentQuiz.quizId,
    }).catch((error) => console.warn("Violation broadcast failed:", error));

    // Broadcast violation event to admin
    try {
      await pusherServer.trigger("private-admin-dashboard", "activity", {
        userId: session.userId,
        fullName: session.fullName,
        role: "student",
        activity: `Violation (${violationType}) flagged for ${session.fullName} on ${studentQuiz.quiz.title}`,
        timestamp: violation.timestamp.toISOString(),
      });
    } catch (e) {
      console.error("Failed to broadcast violation to admin:", e);
    }

    return NextResponse.json({
      success: true,
      violationCount: violationResult.count,
      violation: {
        id: String(violation.id),
        studentQuizId: String(violation.studentQuizId),
        violationType: violation.violationType,
        timestamp: violation.timestamp.toISOString(),
      }
    });

  } catch (error) {
    console.error("Record violation error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export const POST = withBackupWriteGate(POSTImpl);
