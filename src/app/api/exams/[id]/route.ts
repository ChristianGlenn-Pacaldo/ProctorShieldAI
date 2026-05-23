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
      },
    });

    return NextResponse.json({ success: true, exam: updatedExam });
  } catch (error) {
    console.error("Update exam error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
