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
    const quizId = parseInt(id);

    const quiz = await prisma.quiz.findUnique({
      where: { id: quizId },
      include: {
        subject: true,
        questions: {
          include: {
            choices: true
          }
        }
      }
    });

    if (!quiz) {
      return NextResponse.json({ error: "Quiz not found" }, { status: 404 });
    }

    let questions = quiz.questions;
    let studentQuiz: Awaited<ReturnType<typeof prisma.studentQuiz.findFirst>> = null;

    // Check permissions and apply shuffling/stripping for students
    if (session.role === "student") {
      studentQuiz = await prisma.studentQuiz.findFirst({
        where: {
          studentId: session.userId,
          quizId: quiz.id
        }
      });

      if (!studentQuiz) {
        return NextResponse.json({ error: "You are not enrolled in this quiz" }, { status: 403 });
      }

      if (quiz.quizStatus === "ended") {
        return NextResponse.json({ error: "This quiz has already ended." }, { status: 403 });
      }

      const isDraftOrScheduled = quiz.quizStatus === "draft" || quiz.quizStatus === "scheduled";

      if (!isDraftOrScheduled && quiz.shuffleQuestions) {
        // Shuffle questions deterministically using the student's unique studentQuiz.id
        questions = shuffleArray(quiz.questions, studentQuiz.id);
        
        // Also shuffle choices for each question deterministically
        questions = questions.map((q) => ({
          ...q,
          choices: shuffleArray(q.choices, `${studentQuiz!.id}-${q.id}`)
        }));
      }
    }

    const isDraftOrScheduled = session.role === "student" && (quiz.quizStatus === "draft" || quiz.quizStatus === "scheduled");
    const safeQuestions = isDraftOrScheduled ? [] : questions;

    return NextResponse.json({
      success: true,
      userId: session.userId,
      studentQuizStatus: session.role === "student" ? studentQuiz?.quizStatus : undefined,
      studentQuizId: session.role === "student" ? studentQuiz?.id : undefined,
      quiz: {
        id: quiz.id,
        title: quiz.title,
        description: quiz.description,
        duration: quiz.duration,
        totalQuestions: quiz.totalQuestions || quiz.questions.length,
        passingScore: quiz.passingScore,
        shuffleQuestions: quiz.shuffleQuestions,
        quizStatus: quiz.quizStatus,
        teacherId: quiz.teacherId,
        subject: quiz.subject,
      },
      questions: safeQuestions.map(q => ({
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
    console.error("Get quiz details error:", error);
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
    const quizId = parseInt(id);
    const body = await req.json();

    const existingQuiz = await prisma.quiz.findUnique({
      where: { id: quizId },
    });

    if (!existingQuiz || existingQuiz.teacherId !== session.userId) {
      return NextResponse.json({ error: "Quiz not found or unauthorized" }, { status: 404 });
    }

    const updatedQuiz = await prisma.quiz.update({
      where: { id: quizId },
      data: {
        quizStatus: body.quizStatus !== undefined ? body.quizStatus : existingQuiz.quizStatus,
        duration: body.duration !== undefined ? parseInt(body.duration) : existingQuiz.duration,
      },
    });

    // Broadcast quiz status update to all waiting students in lobby
    if (body.quizStatus) {
      try {
        const { pusherServer } = await import("@/lib/pusher");
        await pusherServer.trigger(`quiz-${quizId}`, "quiz-started", {
          quizId,
          quizStatus: body.quizStatus,
        });
      } catch (e) {
        console.error("Failed to broadcast quiz status update:", e);
      }
    }

    return NextResponse.json({ success: true, quiz: updatedQuiz });
  } catch (error) {
    console.error("Update quiz error:", error);
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
    const quizId = parseInt(id);

    const existingQuiz = await prisma.quiz.findUnique({
      where: { id: quizId },
    });

    if (!existingQuiz) {
      return NextResponse.json({ error: "Quiz not found" }, { status: 404 });
    }

    // Only the teacher who created the quiz or an admin can delete it
    if (session.role !== "admin" && existingQuiz.teacherId !== session.userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    // Perform cascade delete in a transaction
    await prisma.$transaction(async (tx) => {
      // 1. Get questions
      const questions = await tx.question.findMany({
        where: { quizId },
        select: { id: true }
      });
      const questionIds = questions.map(q => q.id);

      // 2. Get student quizzes
      const studentQuizzes = await tx.studentQuiz.findMany({
        where: { quizId },
        select: { id: true }
      });
      const studentQuizIds = studentQuizzes.map(se => se.id);

      if (studentQuizIds.length > 0) {
        // Get violations to delete evidence files first
        const violations = await tx.violation.findMany({
          where: { studentQuizId: { in: studentQuizIds } },
          select: { id: true }
        });
        const violationIds = violations.map(v => v.id);

        if (violationIds.length > 0) {
          await tx.evidenceFile.deleteMany({
            where: { violationId: { in: violationIds } }
          });
        }

        await tx.violation.deleteMany({
          where: { studentQuizId: { in: studentQuizIds } }
        });

        await tx.aiAnalysis.deleteMany({
          where: { studentQuizId: { in: studentQuizIds } }
        });

        await tx.answer.deleteMany({
          where: { studentQuizId: { in: studentQuizIds } }
        });

        await tx.studentQuiz.deleteMany({
          where: { id: { in: studentQuizIds } }
        });
      }

      if (questionIds.length > 0) {
        await tx.choice.deleteMany({
          where: { questionId: { in: questionIds } }
        });

        await tx.question.deleteMany({
          where: { quizId }
        });
      }

      // Finally, delete the quiz itself
      await tx.quiz.delete({
        where: { id: quizId }
      });
    });

    // Log activity
    await prisma.activityLog.create({
      data: {
        userId: session.userId,
        activity: `Deleted quiz: ${existingQuiz.title}`,
        ipAddress: req.headers.get("x-forwarded-for") || "unknown",
      },
    });

    // Broadcast quiz deletion to admin
    try {
      const { pusherServer } = await import("@/lib/pusher");
      await pusherServer.trigger("admin-dashboard", "activity", {
        type: "quiz-deleted",
        userId: session.userId,
        fullName: session.fullName,
        role: session.role,
        activity: `Deleted quiz: ${existingQuiz.title}`,
        timestamp: new Date().toISOString(),
      });
    } catch (e) {
      console.error("Failed to broadcast quiz deletion to admin:", e);
    }

    return NextResponse.json({ success: true, message: "Quiz deleted successfully" });
  } catch (error) {
    console.error("Delete quiz error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
