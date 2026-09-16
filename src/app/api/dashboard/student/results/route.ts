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

    const normalizedResults = results.map((result) => {
      // Historical classification: StudentQuiz.attemptMode is authoritative
      const effectiveMode = result.attemptMode === "arena" ? "arena" : "proctored";
      const isArena = effectiveMode === "arena";

      if (isArena) {
        return {
          ...result,
          effectiveMode: "arena" as const,
          modeLabel: "Power Arena",
          aiVerdict: null,
          cheatingProbability: null,
          aiAnalysis: null,
          integrityInvalidated: false,
        };
      }

      const isInvalidated = result.aiVerdict === "cheated";
      return {
        ...result,
        effectiveMode: "proctored" as const,
        modeLabel: "Live Monitored Exam",
        score: isInvalidated ? null : result.score,
        integrityInvalidated: isInvalidated,
      };
    });

    return NextResponse.json({ success: true, results: normalizedResults });
  } catch (error) {
    console.error("Error fetching results:", error);
    return NextResponse.json({ success: false, message: "Internal server error" }, { status: 500 });
  }
}
