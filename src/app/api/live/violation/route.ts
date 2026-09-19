import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { pusherServer } from "@/lib/pusher";
import { consumeRateLimitGroup, getClientIp } from "@/lib/security";
import { uploadEvidence } from "@/lib/evidence-storage";
import { VALID_VIOLATION_TYPES } from "@/lib/proctoring-detection";

const validViolationTypes = new Set<string>(VALID_VIOLATION_TYPES);

function isValidSnapshot(value: unknown): value is string {
  return typeof value === "string"
    && value.length <= 2_800_000
    && /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(value);
}

export async function POST(req: NextRequest) {
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

    const { quizId, studentQuizId, incidentId, violationType, confidenceScore, screenshot, snapshot } = await req.json();
    if (incidentId != null && (typeof incidentId !== "string" || !/^[a-zA-Z0-9-]{1,64}$/.test(incidentId))) return NextResponse.json({ error: "Invalid incident ID" }, { status: 400 });
    const evidence = screenshot ?? snapshot;
    const numericQuizId = Number(quizId);

    if (!Number.isInteger(numericQuizId) || !validViolationTypes.has(violationType)) {
      return NextResponse.json({ error: "Invalid violation event" }, { status: 400 });
    }
    if (evidence != null && !isValidSnapshot(evidence)) {
      return NextResponse.json({ error: "Invalid or oversized evidence image" }, { status: 413 });
    }

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
        } else if (process.env.NODE_ENV !== "production") {
          await prisma.violation.update({
            where: { id: violation.id },
            data: { screenshotPath: evidence },
          });
        }
      } catch (error) {
        console.error("Permanent evidence upload failed:", error);
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
