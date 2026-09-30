import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getMaintenanceStatus, runMaintenance } from "@/lib/maintenance";

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function authorizationError(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || secret.length < 32) {
    return NextResponse.json({ error: "Maintenance is not configured" }, { status: 503 });
  }
  const authorization = request.headers.get("authorization") || "";
  const supplied = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!supplied || !safeEqual(supplied, secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

export async function GET(request: NextRequest) {
  const denied = authorizationError(request);
  if (denied) return denied;
  try {
    const status = await getMaintenanceStatus();
    return NextResponse.json(status, {
      status: status.status === "ok" ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    console.error("Maintenance status failed");
    return NextResponse.json({ error: "Maintenance status unavailable" }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  const denied = authorizationError(request);
  if (denied) return denied;

  try {
    const result = await runMaintenance();
    console.info("Scheduled maintenance completed:", result);
    return NextResponse.json({ success: true, result });
  } catch {
    console.error("Scheduled maintenance failed");
    return NextResponse.json({ error: "Maintenance failed" }, { status: 500 });
  }
}
