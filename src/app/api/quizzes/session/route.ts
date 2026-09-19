import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getSession } from "@/lib/auth";
import prisma from "@/lib/prisma";
import {
  getMonitoringLevel,
  normalizeDeviceCapabilities,
} from "@/lib/device-capabilities";

export async function POST(req: NextRequest) {
  try {
    const session = await getSession("student");
    if (!session || session.role !== "student") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const quizId = Number(body.quizId);
    if (!Number.isInteger(quizId)) {
      return NextResponse.json({ error: "Invalid quiz" }, { status: 400 });
    }

    if (body.action === "start") {
      const attempt = await prisma.studentQuiz.findFirst({
        where: { id: String(body.studentQuizId || ""), studentId: session.userId, quizId },
        include: { quiz: { include: { _count: { select: { questions: true } } } } },
      });
      if (!attempt || attempt.attemptMode === "arena" || attempt.quiz.quizMode === "arena"
        || attempt.endTime || !["enrolled", "in_progress"].includes(attempt.quizStatus || "")
        || !(attempt.quiz.quizStatus === "in_progress" || (attempt.quiz.quizStatus === "ended" && (attempt.attemptNumber > 1 || attempt.startTime)))
        || !["strict", "reduced"].includes(attempt.monitoringLevel || "")
        || attempt.quiz._count.questions < 1) {
        return NextResponse.json({ error: "This attempt is not ready to start" }, { status: 409 });
      }
      // Only the explicit student start may set the clock; retries preserve it.
      await prisma.studentQuiz.updateMany({
        where: { id: attempt.id, endTime: null, startTime: null, quizStatus: "enrolled" },
        data: { quizStatus: "in_progress", startTime: new Date() },
      });
      const active = await prisma.studentQuiz.findUnique({ where: { id: attempt.id } });
      if (!active?.startTime || active.endTime || active.quizStatus !== "in_progress") {
        return NextResponse.json({ error: "Attempt is no longer active" }, { status: 409 });
      }
      return NextResponse.json({ success: true, startTime: active.startTime,
        remainingSeconds: Math.max(0, Math.ceil((active.startTime.getTime() + (attempt.quiz.duration ?? 60) * 60_000 - Date.now()) / 1000)) });
    }

    const quiz = await prisma.quiz.findUnique({
      where: { id: quizId },
      select: { id: true, quizMode: true },
    });
    if (!quiz) {
      return NextResponse.json({ error: "Quiz not found" }, { status: 404 });
    }
    if (quiz.quizMode === "arena") {
      return NextResponse.json(
        {
          error: "Device preflight check is not required for Power Arena matches.",
          code: "PREFLIGHT_NOT_APPLICABLE",
        },
        { status: 400 },
      );
    }

    const capabilities = normalizeDeviceCapabilities(
      body.capabilities,
      req.headers.get("user-agent") || "",
    );
    const monitoringLevel = getMonitoringLevel(capabilities);
    if (monitoringLevel === "unsupported") {
      const error = !capabilities.secureContext
        ? "Camera monitoring requires HTTPS. Open the secure exam link and try again."
        : !capabilities.cameraSupported || !capabilities.cameraPermission
          ? "A working front camera and camera permission are required to start this quiz."
          : !capabilities.microphoneSupported || !capabilities.microphonePermission
            ? "Microphone permission is required for audio monitoring. Enable it in your browser settings and run the device check again."
            : !capabilities.mediaRecorderSupported
              ? "This browser cannot record the required 3–5 second evidence clips. Update Chrome, Safari, or Edge and try again."
              : "This browser cannot provide the required app-switch monitoring.";
      return NextResponse.json(
        {
          error,
          code: "UNSUPPORTED_DEVICE",
          deviceType: capabilities.deviceType,
          monitoringLevel,
        },
        { status: 422 },
      );
    }

    const updated = await prisma.studentQuiz.updateMany({
      where: {
        studentId: session.userId,
        quizId,
        endTime: null,
        quizStatus: { notIn: ["completed", "rejected"] },
      },
      data: {
        deviceType: capabilities.deviceType,
        monitoringLevel,
        deviceCapabilities: capabilities as unknown as Prisma.InputJsonValue,
        lastHeartbeatAt: new Date(),
      },
    });
    if (updated.count !== 1) {
      return NextResponse.json({ error: "Active quiz session not found" }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      deviceType: capabilities.deviceType,
      monitoringLevel,
      capabilities,
    });
  } catch (error) {
    console.error("Quiz session profile error:", error);
    return NextResponse.json({ error: "Failed to update device profile" }, { status: 500 });
  }
}
