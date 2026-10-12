import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { readEvidence } from "@/lib/evidence-storage";
import { expireSubscriptions } from "@/lib/maintenance";
import { hasActiveProSubscription } from "@/lib/teacher-entitlements";

function evidenceResponse(request: Request, bytes: Uint8Array, contentType: string, evidenceId: string) {
  const headers: Record<string, string> = {
    "Content-Type": contentType,
    "Cache-Control": "private, no-store",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "X-Content-Type-Options": "nosniff",
    "Accept-Ranges": "bytes",
  };
  if (new URL(request.url).searchParams.get("download") === "1") {
    const extension = contentType === "video/mp4"
      ? "mp4"
      : contentType === "video/webm"
        ? "webm"
        : contentType === "image/png"
          ? "png"
          : contentType === "image/webp"
            ? "webp"
            : "jpg";
    headers["Content-Disposition"] = `attachment; filename="evidence-${evidenceId}.${extension}"`;
  }
  const range = request.headers.get("range");
  if (contentType.startsWith("video/") && range !== null) {
    // Single byte ranges only. BigInt avoids rounding very large decimal bounds.
    const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    const size = BigInt(bytes.byteLength);
    let start = BigInt(0);
    let end = size - BigInt(1);
    let valid = Boolean(match && (match[1] || match[2])) && size > BigInt(0);
    if (valid && match) {
      if (!match[1]) {
        const suffix = BigInt(match[2]);
        valid = suffix > BigInt(0);
        start = suffix >= size ? BigInt(0) : size - suffix;
      } else {
        start = BigInt(match[1]);
        if (match[2]) end = BigInt(match[2]);
        valid = start < size && end >= start;
        if (end >= size) end = size - BigInt(1);
      }
    }
    if (!valid) {
      headers["Content-Range"] = `bytes */${bytes.byteLength}`;
      headers["Content-Length"] = "0";
      return new NextResponse(null, { status: 416, headers });
    }
    // The storage API already returns a buffer; do not add another full-file read.
    const chunk = bytes.subarray(Number(start), Number(end) + 1);
    headers["Content-Range"] = `bytes ${start}-${end}/${bytes.byteLength}`;
    headers["Content-Length"] = String(chunk.byteLength);
    return new NextResponse(Buffer.from(chunk), { status: 206, headers });
  }
  headers["Content-Length"] = String(bytes.byteLength);
  return new NextResponse(Buffer.from(bytes), { headers });
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !["teacher", "admin"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.role === "teacher") {
    await expireSubscriptions(session.userId);
    if (!await hasActiveProSubscription(session.userId)) {
      return NextResponse.json(
        { error: "Evidence Replay requires an active Pro subscription", code: "SUBSCRIPTION_REQUIRED" },
        { status: 403 },
      );
    }
  }
  const { id } = await params;
  if (!/^\d+$/.test(id)) return NextResponse.json({ error: "Invalid evidence id" }, { status: 400 });

  const violation = await prisma.violation.findUnique({
    where: { id: BigInt(id) },
    include: {
      evidenceFiles: {
        where: { deletionRequestedAt: null, deletedAt: null },
        orderBy: { uploadedAt: "desc" },
        take: 1,
      },
      studentQuiz: { select: { quiz: { select: { teacherId: true } } } },
    },
  });
  if (!violation) return NextResponse.json({ error: "Evidence not found" }, { status: 404 });
  if (session.role === "teacher" && violation.studentQuiz.quiz.teacherId !== session.userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const file = violation.evidenceFiles[0];
  if (!file) {
    if (violation.screenshotPath?.startsWith("data:")) {
      const match = /^data:([^;]+);base64,(.+)$/.exec(violation.screenshotPath);
      if (match) {
        return evidenceResponse(request, Buffer.from(match[2], "base64"), match[1], id);
      }
    }
    return NextResponse.json({ error: "Evidence content has expired" }, { status: 404 });
  }
  const object = await readEvidence(file.filePath);
  if (!object) return NextResponse.json({ error: "Evidence storage unavailable" }, { status: 503 });
  return evidenceResponse(request, object.bytes, object.contentType, id);
}
