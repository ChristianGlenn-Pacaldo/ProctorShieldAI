import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { readEvidence } from "@/lib/evidence-storage";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
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
        return new NextResponse(Buffer.from(match[2], "base64"), {
          headers: { "Content-Type": match[1], "Cache-Control": "private, no-store" },
        });
      }
    }
    return NextResponse.json({ error: "Evidence content has expired" }, { status: 404 });
  }
  const object = await readEvidence(file.filePath);
  if (!object) return NextResponse.json({ error: "Evidence storage unavailable" }, { status: 503 });
  return new NextResponse(Buffer.from(object.bytes), {
    headers: {
      "Content-Type": object.contentType,
      "Cache-Control": "private, no-store",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
