import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { uploadEvidenceBytes } from "@/lib/evidence-storage";
import { consumeRateLimitGroup, getClientIp } from "@/lib/security";

export const runtime = "nodejs";

const VIDEO_TYPES = new Set(["video/webm", "video/mp4"]);

function hasExpectedVideoSignature(bytes: Uint8Array, contentType: string): boolean {
  if (contentType === "video/webm") {
    return bytes.length >= 4
      && bytes[0] === 0x1a
      && bytes[1] === 0x45
      && bytes[2] === 0xdf
      && bytes[3] === 0xa3;
  }
  return bytes.length >= 12
    && String.fromCharCode(...bytes.slice(4, 8)) === "ftyp";
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession();
    if (!session || session.role !== "student") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rateLimit = await consumeRateLimitGroup(
      [`evidence:user:${session.userId}`, `evidence:ip:${getClientIp(req)}`],
      12,
      60_000,
    );
    if (!rateLimit.allowed) {
      return NextResponse.json({ error: "Too many evidence uploads" }, { status: 429 });
    }

    const { id } = await params;
    if (!/^\d+$/.test(id)) {
      return NextResponse.json({ error: "Invalid violation" }, { status: 400 });
    }

    const formData = await req.formData();
    const evidence = formData.get("evidence");
    const durationMs = Number(formData.get("durationMs"));
    if (!(evidence instanceof File) || !Number.isFinite(durationMs) || durationMs < 3_000 || durationMs > 5_500) {
      return NextResponse.json({ error: "Evidence must be a 3–5 second video" }, { status: 400 });
    }

    const contentType = evidence.type.split(";", 1)[0].toLowerCase();
    if (!VIDEO_TYPES.has(contentType) || evidence.size < 1_000 || evidence.size > 6_000_000) {
      return NextResponse.json({ error: "Invalid or oversized evidence video" }, { status: 413 });
    }

    const violation = await prisma.violation.findFirst({
      where: {
        id: BigInt(id),
        studentQuiz: { studentId: session.userId },
        createdAt: { gte: new Date(Date.now() - 2 * 60_000) },
      },
      select: { id: true, studentQuizId: true },
    });
    if (!violation) {
      return NextResponse.json({ error: "Violation is not available for evidence upload" }, { status: 404 });
    }

    const bytes = new Uint8Array(await evidence.arrayBuffer());
    if (!hasExpectedVideoSignature(bytes, contentType)) {
      return NextResponse.json({ error: "Evidence file signature is invalid" }, { status: 400 });
    }

    const stored = await uploadEvidenceBytes(bytes, contentType, violation.studentQuizId);
    if (stored) {
      await prisma.$transaction([
        prisma.evidenceFile.create({
          data: {
            violationId: violation.id,
            fileType: stored.contentType,
            filePath: stored.key,
          },
        }),
        prisma.violation.update({
          where: { id: violation.id },
          data: { durationSeconds: Math.round(durationMs / 1_000) },
        }),
      ]);
    } else if (process.env.NODE_ENV !== "production") {
      await prisma.violation.update({
        where: { id: violation.id },
        data: {
          durationSeconds: Math.round(durationMs / 1_000),
          screenshotPath: `data:${contentType};base64,${Buffer.from(bytes).toString("base64")}`,
        },
      });
    } else {
      return NextResponse.json({ error: "Evidence storage is unavailable" }, { status: 503 });
    }

    return NextResponse.json({ success: true, durationSeconds: Math.round(durationMs / 1_000) });
  } catch (error) {
    console.error("Violation evidence upload error:", error);
    return NextResponse.json({ error: "Failed to store evidence video" }, { status: 500 });
  }
}
