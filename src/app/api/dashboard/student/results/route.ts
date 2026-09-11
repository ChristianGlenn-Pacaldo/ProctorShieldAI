import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";

export async function GET() {
  try {
    const session = await getSession();
    if (!session || session.role !== "student") {
      return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
    }

    const results = await prisma.studentQuiz.findMany({
      where: {
        studentId: session.userId,
      },
      include: {
        quiz: true,
        aiAnalysis: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    const normalizedResults = results.map((result) => result.aiVerdict === "cheated"
      ? { ...result, score: null, integrityInvalidated: true }
      : { ...result, integrityInvalidated: false });

    return NextResponse.json({ success: true, results: normalizedResults });
  } catch (error) {
    console.error("Error fetching results:", error);
    return NextResponse.json({ success: false, message: "Internal server error" }, { status: 500 });
  }
}
