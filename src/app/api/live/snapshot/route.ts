import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

const snapshotStore = new Map<string, {
  studentId: string;
  snapshot: string;
  studentName: string;
  quizTitle: string;
  quizId: number;
  teacherId?: number;
  updatedAt: number;
}>();

(globalThis as any).__snapshotStore = (globalThis as any).__snapshotStore || snapshotStore;

function getStore() {
  return (globalThis as any).__snapshotStore as typeof snapshotStore;
}

// POST: Student uploads a webcam snapshot
export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    const { snapshot, quizId, quizTitle, studentId, studentName, teacherId } = await req.json();

    if (!snapshot) {
      return NextResponse.json({ error: "No snapshot provided" }, { status: 400 });
    }

    const store = getStore();
    const sId = session?.userId ? String(session.userId) : studentId ? String(studentId) : "student";
    const sName = session?.fullName || studentName || "Student";

    const dataObj = {
      studentId: sId,
      snapshot,
      studentName: sName,
      quizTitle: quizTitle || "Quiz",
      quizId: Number(quizId),
      teacherId: teacherId ? Number(teacherId) : undefined,
      updatedAt: Date.now(),
    };

    store.set(sId, dataObj);
    store.set(sName, dataObj);

    // Broadcast snapshot via Pusher in real-time
    try {
      const { pusherServer } = await import("@/lib/pusher");
      if (teacherId) {
        await pusherServer.trigger(`teacher-${teacherId}`, "live-snapshot", {
          studentId: sId,
          studentName: sName,
          quizTitle: quizTitle || "Quiz",
          snapshot,
          timestamp: Date.now(),
        });
      }
      await pusherServer.trigger("teacher-monitor", "live-snapshot", {
        studentId: sId,
        studentName: sName,
        quizTitle: quizTitle || "Quiz",
        snapshot,
        timestamp: Date.now(),
      });
    } catch (pushErr) {
      // Non-blocking pusher error
    }

    // Clean up stale entries older than 2 minutes
    const now = Date.now();
    for (const [key, val] of store.entries()) {
      if (now - val.updatedAt > 120000) {
        store.delete(key);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Snapshot upload error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// GET: Teacher fetches all active student snapshots
export async function GET(req: NextRequest) {
  try {
    const store = getStore();
    const snapshotsMap = new Map<string, any>();
    const now = Date.now();

    for (const [key, val] of store.entries()) {
      // Return snapshots from last 60 seconds
      if (now - val.updatedAt < 60000) {
        snapshotsMap.set(val.studentId, {
          studentId: val.studentId,
          studentName: val.studentName,
          quizTitle: val.quizTitle,
          snapshot: val.snapshot,
          updatedAt: val.updatedAt,
        });
      }
    }

    return NextResponse.json({ snapshots: Array.from(snapshotsMap.values()) });
  } catch (error) {
    console.error("Snapshot fetch error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
