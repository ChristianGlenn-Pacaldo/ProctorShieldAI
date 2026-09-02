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

    const capabilities = normalizeDeviceCapabilities(
      body.capabilities,
      req.headers.get("user-agent") || "",
    );
    const monitoringLevel = getMonitoringLevel(capabilities);
    if (monitoringLevel === "unsupported") {
      return NextResponse.json(
        {
          error: capabilities.secureContext
            ? "A working front camera is required to start this quiz."
            : "Camera monitoring requires HTTPS. Open the secure exam link and try again.",
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
