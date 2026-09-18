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

    const { quizId, violationType, confidenceScore, screenshot, snapshot } = await req.json();
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
        quizStatus: { notIn: ["completed", "rejected"] },
        quiz: { quizMode: { not: "arena" } },
      },
      include: {
        quiz: true,
      },
      orderBy: { attemptNumber: "desc" },
    });

    if (!studentQuiz) {
      return NextResponse.json({ error: "Quiz session not found" }, { status: 404 });
    }
    if (studentQuiz.quiz.quizMode === "arena") {
      return NextResponse.json({ error: "Arena quizzes do not use proctoring violations" }, { status: 400 });
    }

    // Serialize violations per attempt. The three-strike contract must be
    // enforced by the server, not only by browser code that can be bypassed.
    const violationResult = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`quiz-violations:${studentQuiz.id}`}))`;
      const existingCount = await tx.violation.count({ where: { studentQuizId: studentQuiz.id } });
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
      return { violation, count: existingCount + 1 };
    });

    if (!violationResult.violation) {
      return NextResponse.json(
        { error: "Violation limit reached", code: "VIOLATION_LIMIT_REACHED", violationCount: 3 },
        { status: 409 },
      );
    }
    const violation = violationResult.violation;

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
    });

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
