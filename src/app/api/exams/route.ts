import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (session.role === "teacher") {
      // Teachers get the exams they created
      const exams = await prisma.exam.findMany({
        where: { teacherId: session.userId },
        include: {
          subject: true,
          _count: { select: { studentExams: true } },
        },
        orderBy: { createdAt: "desc" },
      });
      return NextResponse.json({ success: true, exams });
    } else if (session.role === "student") {
      // Students get the exams they have joined
      const studentExams = await prisma.studentExam.findMany({
        where: { studentId: session.userId },
        include: {
          exam: {
            include: { subject: true, teacher: true },
          },
        },
        orderBy: { createdAt: "desc" },
      });
      return NextResponse.json({ success: true, exams: studentExams });
    } else if (session.role === "admin") {
      // Admins get all exams
      const exams = await prisma.exam.findMany({
        include: {
          subject: true,
          teacher: true,
          _count: { select: { studentExams: true } },
        },
        orderBy: { createdAt: "desc" },
      });
      return NextResponse.json({ success: true, exams });
    }

    return NextResponse.json({ error: "Invalid role" }, { status: 403 });
  } catch (error) {
    console.error("Fetch exams error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session || session.role !== "teacher") {
      return NextResponse.json({ error: "Unauthorized. Only teachers can create exams." }, { status: 401 });
    }

    const { subjectName, title, description, duration, totalQuestions, passingScore } = await req.json();

    if (!subjectName || !title) {
      return NextResponse.json({ success: false, message: "Subject name and title are required" }, { status: 400 });
    }

    // Verify the teacher actually exists in the database (catches stale JWT after db reset)
    const teacherExists = await prisma.user.findUnique({ where: { id: session.userId } });
    if (!teacherExists) {
      return NextResponse.json({ 
        success: false, 
        message: "Your session is outdated. Please log out and log back in." 
      }, { status: 401 });
    }

    // Find or create subject
    let subject = await prisma.subject.findFirst({
      where: { 
        teacherId: session.userId,
        subjectName: { equals: subjectName, mode: "insensitive" }
      }
    });

    if (!subject) {
      subject = await prisma.subject.create({
        data: {
          teacherId: session.userId,
          subjectName: subjectName,
          subjectCode: `SUB-${Math.floor(1000 + Math.random() * 9000)}`
        }
      });
    }

    // Generate random 4-digit access code (e.g. PS-1234)
    const accessCode = `PS-${Math.floor(1000 + Math.random() * 9000)}`;

    const exam = await prisma.exam.create({
      data: {
        teacherId: session.userId,
        subjectId: subject.id,
        title,
        description,
        accessCode,
        duration: duration || 60,
        totalQuestions: totalQuestions || 10,
        passingScore: passingScore || 50,
        examStatus: "draft",
      },
    });

    // Log activity
    await prisma.activityLog.create({
      data: {
        userId: session.userId,
        activity: `Created exam: ${title}`,
        ipAddress: req.headers.get("x-forwarded-for") || "unknown",
      },
    });

    return NextResponse.json({ success: true, exam }, { status: 201 });
  } catch (error) {
    console.error("Create exam error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
