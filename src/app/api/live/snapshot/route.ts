import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { getSnapshotsForTeacher, saveSnapshot, type SnapshotRecord } from "@/lib/snapshot-store";
import { hasActiveProSubscription } from "@/lib/teacher-entitlements";

const MAX_SNAPSHOT_LENGTH = 2_000_000;

export async function POST(req: NextRequest) {
  try {
    const session = await getSession("student");
    if (!session || session.role !== "student") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { snapshot, quizId } = await req.json();
    if (
      typeof snapshot !== "string" ||
      snapshot.length > MAX_SNAPSHOT_LENGTH ||
      !/^data:image\/(jpeg|jpg|png|webp);base64,/.test(snapshot)
    ) {
      return NextResponse.json({ error: "Invalid or oversized snapshot" }, { status: 400 });
    }

    const numericQuizId = Number(quizId);
    if (!Number.isInteger(numericQuizId)) {
      return NextResponse.json({ error: "Invalid quiz" }, { status: 400 });
    }

    const enrollment = await prisma.studentQuiz.findFirst({
      where: {
        studentId: session.userId,
        quizId: numericQuizId,
        quizStatus: { notIn: ["rejected", "pending_approval", "completed"] },
        quiz: { quizStatus: "in_progress" },
      },
      include: { quiz: { select: { title: true, teacherId: true } } },
    });
    if (!enrollment) {
      return NextResponse.json({ error: "Active quiz session not found" }, { status: 403 });
    }

    const record: SnapshotRecord = {
      studentId: session.userId,
      snapshot,
      studentName: session.fullName,
      quizTitle: enrollment.quiz.title,
      quizId: numericQuizId,
      teacherId: enrollment.quiz.teacherId,
      deviceType: enrollment.deviceType === "mobile" ? "mobile" : "desktop",
      monitoringLevel: enrollment.monitoringLevel === "strict" ? "strict" : "reduced",
      connectionStatus: "online",
      updatedAt: Date.now(),
    };
    await saveSnapshot(record);

    try {
      const { pusherServer } = await import("@/lib/pusher");
      await pusherServer.trigger(
        `private-teacher-${record.teacherId}`,
        "live-snapshot",
        {
          studentId: record.studentId,
          studentName: record.studentName,
          quizTitle: record.quizTitle,
          snapshot: record.snapshot,
          deviceType: record.deviceType,
          monitoringLevel: record.monitoringLevel,
          connectionStatus: record.connectionStatus,
          timestamp: record.updatedAt,
        }
      );
    } catch (error: unknown) {
      console.error("Snapshot broadcast failed:", error);
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error("Snapshot upload error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function GET() {
  try {
    const session = await getSession("teacher");
    if (!session || session.role !== "teacher") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!await hasActiveProSubscription(session.userId)) {
      return NextResponse.json(
        { error: "Live monitoring requires an active Pro subscription", code: "SUBSCRIPTION_REQUIRED" },
        { status: 403 },
      );
    }

    const snapshots = (await getSnapshotsForTeacher(session.userId))
      .map(({ studentId, studentName, quizTitle, snapshot, deviceType, monitoringLevel, connectionStatus, updatedAt }) => ({
        studentId,
        studentName,
        quizTitle,
        snapshot,
        deviceType,
        monitoringLevel,
        connectionStatus,
        updatedAt,
      }));

    return NextResponse.json({ snapshots });
  } catch (error: unknown) {
    console.error("Snapshot fetch error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
