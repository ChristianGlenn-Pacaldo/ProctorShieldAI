import { NextRequest, NextResponse } from "next/server";
import {
  getBackupWriteGateStatus,
  acquireBackupWriteLease,
  releaseBackupWriteLease,
  BackupGateControlError,
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

// Bound parsing before JSON allocation; never log the body or capability.
async function controlBody(request: NextRequest) {
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json" || !request.body) {
    throw new BackupGateControlError("GATE_BODY", 400);
  }
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      bytes += value.length; if (bytes > 2048) throw new BackupGateControlError("GATE_BODY_SIZE", 413);
      chunks.push(value);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { throw new BackupGateControlError("GATE_BODY", 400); }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
function controlError(error: unknown) {
  if (error instanceof BackupGateControlError) return NextResponse.json({ error: error.code }, { status: error.status, headers: noStore });
  console.error("Backup write gate control unavailable");
  return NextResponse.json({ error: "Backup gate unavailable" }, { status: 503, headers: noStore });
}


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
    return NextResponse.json(await acquireBackupWriteLease(await controlBody(request)), { headers: noStore });
  } catch (error) {
    return controlError(error);
  }
}

export async function DELETE(request: NextRequest) {
  const denied = authorizationError(request);
  if (denied) return denied;
  try {
    return NextResponse.json(await releaseBackupWriteLease(await controlBody(request)), { headers: noStore });
  } catch (error) {
    return controlError(error);
  }
}
