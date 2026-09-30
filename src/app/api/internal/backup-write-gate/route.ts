import { NextRequest, NextResponse } from "next/server";
import {
  getBackupWriteGateStatus,
  setBackupWritePause,
  stagingWriteGateConfigured,
  stagingWriteGateSecret,
  validGateBearer,
} from "@/lib/backup-write-gate";

export const dynamic = "force-dynamic";

function authorizationError(request: NextRequest) {
  if (!stagingWriteGateConfigured()) {
    return NextResponse.json({ error: "Unavailable" }, { status: 404 });
  }
  const secret = stagingWriteGateSecret();
  if (!secret) {
    return NextResponse.json({ error: "Backup gate is not configured" }, { status: 503 });
  }
  if (!validGateBearer(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

const noStore = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest) {
  const denied = authorizationError(request);
  if (denied) return denied;
  try {
    return NextResponse.json(await getBackupWriteGateStatus(), { headers: noStore });
  } catch {
    console.error("Backup write gate status unavailable");
    return NextResponse.json({ error: "Backup gate unavailable" }, { status: 503, headers: noStore });
  }
}

export async function POST(request: NextRequest) {
  const denied = authorizationError(request);
  if (denied) return denied;
  try {
    return NextResponse.json(await setBackupWritePause(true), { headers: noStore });
  } catch {
    console.error("Backup write gate activation failed");
    return NextResponse.json({ error: "Backup gate unavailable" }, { status: 503, headers: noStore });
  }
}

export async function DELETE(request: NextRequest) {
  const denied = authorizationError(request);
  if (denied) return denied;
  try {
    return NextResponse.json(await setBackupWritePause(false), { headers: noStore });
  } catch {
    console.error("Backup write gate deactivation failed");
    return NextResponse.json({ error: "Backup gate unavailable" }, { status: 503, headers: noStore });
  }
}
