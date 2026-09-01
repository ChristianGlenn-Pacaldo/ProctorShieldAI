import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { runMaintenance } from "@/lib/maintenance";

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || secret.length < 32) {
    return NextResponse.json({ error: "Maintenance is not configured" }, { status: 503 });
  }
  const authorization = request.headers.get("authorization") || "";
  const supplied = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!supplied || !safeEqual(supplied, secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runMaintenance();
    return NextResponse.json({ success: true, result });
  } catch (error) {
    console.error("Scheduled maintenance failed:", error);
    return NextResponse.json({ error: "Maintenance failed" }, { status: 500 });
  }
}
