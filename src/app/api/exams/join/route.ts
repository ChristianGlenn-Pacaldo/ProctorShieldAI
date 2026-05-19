import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session || session.role !== "student") {
      return NextResponse.json({ error: "Unauthorized. Only students can join exams." }, { status: 401 });
    }

    const { accessCode } = await req.json();

    if (!accessCode) {
      return NextResponse.json({ error: "Access code is required" }, { status: 400 });
    }

    // Verify the student actually exists in the database (catches stale JWT after db reset)
    const studentExists = await prisma.user.findUnique({ where: { id: session.userId } });
    if (!studentExists) {
      return NextResponse.json({ 
        error: "Your session is outdated. Please log out and log back in." 
      }, { status: 401 });
    }

    // Find the exam by access code
    const exam = await prisma.exam.findUnique({
      where: { accessCode: accessCode.trim().toUpperCase() },
      include: { subject: true },
    });

    if (!exam) {
      return NextResponse.json({ error: "Invalid access code. Exam not found." }, { status: 404 });
    }

    // Check if the student has already joined this exam
    const existingEnrollment = await prisma.studentExam.findFirst({
      where: {
        studentId: session.userId,
        examId: exam.id,
      },
    });

    if (existingEnrollment) {
      return NextResponse.json({ error: "You have already joined this exam." }, { status: 409 });
    }

    // Enroll student
    const studentExam = await prisma.studentExam.create({
      data: {
        studentId: session.userId,
        examId: exam.id,
        examStatus: "enrolled",
      },
    });

    // Log activity
    await prisma.activityLog.create({
      data: {
        userId: session.userId,
        activity: `Joined exam: ${exam.title} (${accessCode})`,
        ipAddress: req.headers.get("x-forwarded-for") || "unknown",
      },
    });

    return NextResponse.json({
      success: true,
      message: `Successfully joined ${exam.title}`,
      exam: {
        id: exam.id,
        title: exam.title,
        subject: exam.subject.subjectName,
      },
    }, { status: 201 });

  } catch (error) {
    console.error("Join exam error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
