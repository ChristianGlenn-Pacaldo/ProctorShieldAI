import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";

// Seeded random number generator (Mulberry32 variant)
function seededRandom(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0;
  }
  return function() {
    let t = h += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Seeded array shuffling helper
function shuffleArray<T>(array: T[], seed: string): T[] {
  const rand = seededRandom(seed);
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const examId = parseInt(id);

    const exam = await prisma.exam.findUnique({
      where: { id: examId },
      include: {
        subject: true,
        questions: {
          include: {
            choices: true
          }
        }
      }
    });

    if (!exam) {
      return NextResponse.json({ error: "Exam not found" }, { status: 404 });
    }

    let questions = exam.questions;

    // Check permissions and apply shuffling/stripping for students
    if (session.role === "student") {
      const studentExam = await prisma.studentExam.findFirst({
        where: {
          studentId: session.userId,
          examId: exam.id
        }
      });

      if (!studentExam) {
        return NextResponse.json({ error: "You are not enrolled in this exam" }, { status: 403 });
      }

      if (exam.examStatus === "draft") {
        return NextResponse.json({ error: "This exam is not yet active." }, { status: 403 });
      }

      if (exam.examStatus === "ended") {
        return NextResponse.json({ error: "This exam has already ended." }, { status: 403 });
      }

      if (exam.shuffleQuestions) {
        // Shuffle questions deterministically using the student's unique studentExam.id
        questions = shuffleArray(exam.questions, studentExam.id);
        
        // Also shuffle choices for each question deterministically
        questions = questions.map((q) => ({
          ...q,
          choices: shuffleArray(q.choices, `${studentExam.id}-${q.id}`)
        }));
      }
    }

    return NextResponse.json({
      success: true,
      exam: {
        id: exam.id,
        title: exam.title,
        description: exam.description,
        duration: exam.duration,
        totalQuestions: exam.totalQuestions,
        passingScore: exam.passingScore,
        shuffleQuestions: exam.shuffleQuestions,
        subject: exam.subject,
      },
      questions: questions.map(q => ({
        id: q.id,
        questionText: q.questionText,
        questionType: q.questionType,
        points: q.points,
        choices: q.choices.map(c => ({
          id: c.id,
          choiceText: c.choiceText,
          // Exclude correct choice information from student network responses
          ...(session.role !== "student" ? { isCorrect: c.isCorrect } : {})
        }))
      }))
    });

  } catch (error) {
    console.error("Get exam details error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}


export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session || session.role !== "teacher") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const examId = parseInt(id);
    const body = await req.json();

    const existingExam = await prisma.exam.findUnique({
      where: { id: examId },
    });

    if (!existingExam || existingExam.teacherId !== session.userId) {
      return NextResponse.json({ error: "Exam not found or unauthorized" }, { status: 404 });
    }

    const updatedExam = await prisma.exam.update({
      where: { id: examId },
      data: {
        examStatus: body.examStatus !== undefined ? body.examStatus : existingExam.examStatus,
        duration: body.duration !== undefined ? parseInt(body.duration) : existingExam.duration,
      },
    });

    return NextResponse.json({ success: true, exam: updatedExam });
  } catch (error) {
    console.error("Update exam error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session || (session.role !== "teacher" && session.role !== "admin")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const examId = parseInt(id);

    const existingExam = await prisma.exam.findUnique({
      where: { id: examId },
    });

    if (!existingExam) {
      return NextResponse.json({ error: "Exam not found" }, { status: 404 });
    }

    // Only the teacher who created the exam or an admin can delete it
    if (session.role !== "admin" && existingExam.teacherId !== session.userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    // Perform cascade delete in a transaction
    await prisma.$transaction(async (tx) => {
      // 1. Get questions
      const questions = await tx.question.findMany({
        where: { examId },
        select: { id: true }
      });
      const questionIds = questions.map(q => q.id);

      // 2. Get student exams
      const studentExams = await tx.studentExam.findMany({
        where: { examId },
        select: { id: true }
      });
      const studentExamIds = studentExams.map(se => se.id);

      if (studentExamIds.length > 0) {
        // Get violations to delete evidence files first
        const violations = await tx.violation.findMany({
          where: { studentExamId: { in: studentExamIds } },
          select: { id: true }
        });
        const violationIds = violations.map(v => v.id);

        if (violationIds.length > 0) {
          await tx.evidenceFile.deleteMany({
            where: { violationId: { in: violationIds } }
          });
        }

        await tx.violation.deleteMany({
          where: { studentExamId: { in: studentExamIds } }
        });

        await tx.aiAnalysis.deleteMany({
          where: { studentExamId: { in: studentExamIds } }
        });

        await tx.answer.deleteMany({
          where: { studentExamId: { in: studentExamIds } }
        });

        await tx.studentExam.deleteMany({
          where: { id: { in: studentExamIds } }
        });
      }

      if (questionIds.length > 0) {
        await tx.choice.deleteMany({
          where: { questionId: { in: questionIds } }
        });

        await tx.question.deleteMany({
          where: { examId }
        });
      }

      // Finally, delete the exam itself
      await tx.exam.delete({
        where: { id: examId }
      });
    });

    // Log activity
    await prisma.activityLog.create({
      data: {
        userId: session.userId,
        activity: `Deleted exam: ${existingExam.title}`,
        ipAddress: req.headers.get("x-forwarded-for") || "unknown",
      },
    });

    // Broadcast exam deletion to admin
    try {
      const { pusherServer } = await import("@/lib/pusher");
      await pusherServer.trigger("admin-dashboard", "activity", {
        type: "exam-deleted",
        userId: session.userId,
        fullName: session.fullName,
        role: session.role,
        activity: `Deleted exam: ${existingExam.title}`,
        timestamp: new Date().toISOString(),
      });
    } catch (e) {
      console.error("Failed to broadcast exam deletion to admin:", e);
    }

    return NextResponse.json({ success: true, message: "Exam deleted successfully" });
  } catch (error) {
    console.error("Delete exam error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
