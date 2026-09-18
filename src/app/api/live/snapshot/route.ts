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
        endTime: null,
        quizStatus: { notIn: ["completed", "rejected"] },
        quiz: { quizMode: { not: "arena" } },
      },
      include: { quiz: { select: { title: true, teacherId: true, quizMode: true, quizStatus: true } } },
      orderBy: { attemptNumber: "desc" },
    });
    if (!enrollment) {
      return NextResponse.json({ error: "Active quiz session not found" }, { status: 403 });
    }
    if (enrollment.quiz.quizMode === "arena") {
      return NextResponse.json({ error: "Arena quizzes do not use live monitor" }, { status: 400 });
    }
    if (!enrollment.startTime && enrollment.quiz.quizStatus === "in_progress" && enrollment.quizStatus === "in_progress") {
      await prisma.studentQuiz.update({
        where: { id: enrollment.id },
        data: { startTime: new Date() },
      }).catch(() => {});
    }
    if (!await hasActiveProSubscription(enrollment.quiz.teacherId)) {
      return NextResponse.json(
        { error: "Live monitoring requires the teacher's active Pro subscription", code: "SUBSCRIPTION_REQUIRED" },
        { status: 403 },
      );
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
