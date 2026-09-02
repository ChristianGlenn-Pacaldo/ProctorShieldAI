import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { readEvidence } from "@/lib/evidence-storage";

function evidenceResponse(request: Request, bytes: Uint8Array, contentType: string) {
  const headers: Record<string, string> = {
    "Content-Type": contentType,
    "Cache-Control": "private, no-store",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "X-Content-Type-Options": "nosniff",
    "Accept-Ranges": "bytes",
  };
  const range = request.headers.get("range");
  if (contentType.startsWith("video/") && range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (match) {
      const start = match[1] ? Number(match[1]) : 0;
      const requestedEnd = match[2] ? Number(match[2]) : bytes.byteLength - 1;
      const end = Math.min(requestedEnd, bytes.byteLength - 1);
      if (Number.isInteger(start) && Number.isInteger(end) && start >= 0 && start <= end) {
        const chunk = bytes.slice(start, end + 1);
        headers["Content-Range"] = `bytes ${start}-${end}/${bytes.byteLength}`;
        headers["Content-Length"] = String(chunk.byteLength);
        return new NextResponse(Buffer.from(chunk), { status: 206, headers });
      }
    }
  }
  headers["Content-Length"] = String(bytes.byteLength);
  return new NextResponse(Buffer.from(bytes), { headers });
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !["teacher", "admin"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  if (!/^\d+$/.test(id)) return NextResponse.json({ error: "Invalid evidence id" }, { status: 400 });

  const violation = await prisma.violation.findUnique({
    where: { id: BigInt(id) },
    include: {
      evidenceFiles: { orderBy: { uploadedAt: "desc" }, take: 1 },
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
        return evidenceResponse(request, Buffer.from(match[2], "base64"), match[1]);
      }
    }
    return NextResponse.json({ error: "Evidence content has expired" }, { status: 404 });
  }
  const object = await readEvidence(file.filePath);
  if (!object) return NextResponse.json({ error: "Evidence storage unavailable" }, { status: 503 });
  return evidenceResponse(request, object.bytes, object.contentType);
}
