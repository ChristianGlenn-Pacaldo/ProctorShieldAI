import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { logDebug } from "@/lib/debug-logger";

// In-memory snapshot store: studentName -> { snapshot, examTitle, updatedAt }
// This avoids Pusher's 10KB limit entirely
const snapshotStore = new Map<string, {
  snapshot: string;
  studentName: string;
  examTitle: string;
  examId: number;
  updatedAt: number;
 }>();

// Make it available globally so other routes can access it
(globalThis as any).__snapshotStore = (globalThis as any).__snapshotStore || snapshotStore;

function getStore() {
  return (globalThis as any).__snapshotStore as typeof snapshotStore;
}

// POST: Student uploads a webcam snapshot
export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    logDebug(`POST /api/live/snapshot: session=${JSON.stringify(session)}`);
    if (!session || session.role !== "student") {
      logDebug(`POST /api/live/snapshot: Unauthorized role=${session?.role}`);
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { snapshot, examId, examTitle } = await req.json();

    if (!snapshot) {
      logDebug("POST /api/live/snapshot: Missing snapshot data");
      return NextResponse.json({ error: "No snapshot" }, { status: 400 });
    }

    const store = getStore();
    store.set(session.fullName, {
      snapshot,
      studentName: session.fullName,
      examTitle: examTitle || "Exam",
      examId: Number(examId),
      updatedAt: Date.now(),
    });
    logDebug(`POST /api/live/snapshot: Stored snapshot for ${session.fullName} (active count: ${store.size})`);

    // Clean up stale entries older than 2 minutes
    const now = Date.now();
    for (const [key, val] of store.entries()) {
      if (now - val.updatedAt > 120000) {
        store.delete(key);
        logDebug(`POST /api/live/snapshot: Cleaned up stale snapshot for ${key}`);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Snapshot upload error:", error);
    logDebug(`POST /api/live/snapshot ERROR: ${error}`);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// GET: Teacher fetches all active student snapshots
export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    logDebug(`GET /api/live/snapshot: session=${JSON.stringify(session)}`);
    if (!session || session.role !== "teacher") {
      logDebug(`GET /api/live/snapshot: Unauthorized role=${session?.role}`);
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const store = getStore();
    const snapshots: any[] = [];
    const now = Date.now();

    for (const [key, val] of store.entries()) {
      // Only return snapshots from the last 30 seconds (active students)
      if (now - val.updatedAt < 30000) {
        snapshots.push({
          studentName: val.studentName,
          examTitle: val.examTitle,
          snapshot: val.snapshot,
          updatedAt: val.updatedAt,
        });
      }
    }
    logDebug(`GET /api/live/snapshot: Returning ${snapshots.length} active snapshots`);

    return NextResponse.json({ snapshots });
  } catch (error) {
    console.error("Snapshot fetch error:", error);
    logDebug(`GET /api/live/snapshot ERROR: ${error}`);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
