import { withBackupWriteGate } from "@/lib/backup-write-gate";
import { after, NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { pusherServer } from "@/lib/pusher";

async function POSTImpl(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session || session.role !== "student") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { quizId, studentQuizId } = await req.json();

    if (!quizId) {
      return NextResponse.json({ error: "Missing quizId" }, { status: 400 });
    }

    const enrollment = await prisma.studentQuiz.findFirst({
      where: {
        studentId: session.userId,
        quizId: Number(quizId),
        endTime: null,
        quizStatus: "in_progress",
        startTime: { not: null },
        quiz: { quizMode: { not: "arena" } },
      },
      include: { quiz: true },
      orderBy: { attemptNumber: "desc" },
    });

    if (!enrollment || studentQuizId !== enrollment.id) {
      return NextResponse.json({ error: "Quiz session not found" }, { status: 404 });
    }
    const quiz = enrollment.quiz;
    if (quiz.quizMode === "arena") {
      return NextResponse.json({ success: true, message: "Arena join ignored for proctored monitor" });
    }



    // Broadcast lightweight "student-joined" event to the teacher's channel
    // NO snapshot data here — snapshots go through /api/live/snapshot instead
    const channelName = `private-teacher-${quiz.teacherId}`;

    const joinedEvent = {
      studentId: session.userId,
      studentName: session.fullName,
      quizId: quiz.id,
      quizTitle: quiz.title,
      deviceType: enrollment.deviceType === "tablet" ? "tablet" : enrollment.deviceType === "mobile" ? "mobile" : "desktop",
      monitoringLevel: enrollment.monitoringLevel === "strict" ? "strict" : "reduced",
      connectionStatus: "online",
      timestamp: new Date().toISOString(),
    };

    // Enrollment and start are already persisted. Realtime is advisory: an
    // outage must not make a valid monitor registration look like it failed.
    // Teacher polling continues to read the authoritative active attempts.
    try {
      after(async () => {
        const deliveries = await Promise.allSettled([
          pusherServer.trigger(channelName, "student-joined", joinedEvent),
          pusherServer.trigger("private-admin-dashboard", "activity", {
            type: "quiz-join", userId: session.userId, fullName: session.fullName,
            role: "student", activity: `${session.fullName} joined quiz: ${quiz.title}`,
            timestamp: new Date().toISOString(),
          }),
        ]);
        if (deliveries.some(result => result.status === "rejected")) console.error("Live join notification delivery failed");
      });
    } catch { console.error("Live join notification scheduling failed"); }

    return NextResponse.json({ success: true, teacherId: quiz.teacherId });
  } catch (error) {
    console.error("Live join error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export const POST = withBackupWriteGate(POSTImpl);
