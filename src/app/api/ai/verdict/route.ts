import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { generateGeminiWithFallback } from "@/lib/gemini";

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    // System or Teacher can request verdict. For this MVP, let's allow teachers to trigger it or students when submitting
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json({ error: "Gemini API key is not configured" }, { status: 500 });
    }

    const { studentQuizId } = await req.json();
    if (!studentQuizId) {
      return NextResponse.json({ error: "studentQuizId is required" }, { status: 400 });
    }

    // Fetch the quiz session and its violations
    const studentQuiz = await prisma.studentQuiz.findUnique({
      where: { id: studentQuizId },
      include: {
        quiz: true,
        student: true,
        violations: true,
      },
    });

    if (!studentQuiz) {
      return NextResponse.json({ error: "Quiz session not found" }, { status: 404 });
    }

    // Prepare the violation summary for the AI
    const violations = studentQuiz.violations;
    const violationSummary = violations.map((v: { violationType: string | null; confidenceScore: any; timestamp: Date }) => 
      `- ${v.violationType} (Confidence: ${v.confidenceScore}%) at ${v.timestamp.toISOString()}`
    ).join("\n");

    const prompt = `You are ProctorShield AI, an advanced cheating detection system.
    Analyze the following quiz session for a student taking an quiz titled "${studentQuiz.quiz.title}".
    
    Quiz Session Data:
    - Duration: ${studentQuiz.quiz.duration} minutes
    - Total Violations: ${violations.length}
    - Violation Details:
    ${violationSummary || "No violations recorded."}
    
    Based on this data, provide a verdict. Format your response strictly as a JSON object with the following fields:
    - cheatingProbability (number from 0 to 100)
    - riskLevel (string: "low", "medium", or "high")
    - finalVerdict (string: "clean", "suspicious", or "cheated")
    - aiExplanation (string: a concise, 2-3 sentence explanation of the reasoning)
    
    Return ONLY the valid JSON object.`;

    let text: string;
    try {
      text = await generateGeminiWithFallback(prompt, true);
    } catch (chainErr) {
      console.warn("Gemini model chain exhausted, using algorithmic fallback:", chainErr);
      const totalV = violations.length;
      const prob = Math.min(100, totalV * 35);
      text = JSON.stringify({
        cheatingProbability: prob,
        riskLevel: prob > 70 ? "high" : prob > 30 ? "medium" : "low",
        finalVerdict: prob > 70 ? "cheated" : prob > 30 ? "suspicious" : "clean",
        aiExplanation: `Recorded ${totalV} proctoring violations during this session. Risk verdict calculated via rule engine.`,
      });
    }

    let verdictData = JSON.parse(text);

    // Save the verdict in the database
    const aiAnalysis = await prisma.aiAnalysis.upsert({
      where: { studentQuizId },
      update: {
        totalViolations: violations.length,
        cheatingProbability: verdictData.cheatingProbability,
        riskLevel: verdictData.riskLevel,
        finalVerdict: verdictData.finalVerdict,
        aiExplanation: verdictData.aiExplanation,
      },
      create: {
        studentQuizId,
        totalViolations: violations.length,
        cheatingProbability: verdictData.cheatingProbability,
        riskLevel: verdictData.riskLevel,
        finalVerdict: verdictData.finalVerdict,
        aiExplanation: verdictData.aiExplanation,
      },
    });

    // Update the studentQuiz status
    await prisma.studentQuiz.update({
      where: { id: studentQuizId },
      data: {
        aiVerdict: verdictData.finalVerdict,
        cheatingProbability: verdictData.cheatingProbability,
      },
    });

    // Save DB notification for Teacher and Student
    try {
      if (studentQuiz.quiz.teacherId) {
        await prisma.notification.create({
          data: {
            userId: studentQuiz.quiz.teacherId,
            title: "AI Verdict Issued",
            message: `AI generated a ${verdictData.finalVerdict.toUpperCase()} verdict for ${studentQuiz.student?.fullName || "Student"} on "${studentQuiz.quiz.title}".`,
          },
        });
      }
      if (studentQuiz.studentId) {
        await prisma.notification.create({
          data: {
            userId: studentQuiz.studentId,
            title: "AI Proctoring Report Ready",
            message: `AI evaluation for "${studentQuiz.quiz.title}" is ready. Verdict: ${verdictData.finalVerdict.toUpperCase()}.`,
          },
        });
      }
    } catch (nErr) {
      console.error("Failed to create AI verdict notifications:", nErr);
    }

    // Send verdict notification email to student (non-blocking)
    if (studentQuiz.student?.email) {
      try {
        const { sendVerdictEmail } = await import("@/lib/email");
        sendVerdictEmail(
          studentQuiz.student.email,
          studentQuiz.student.fullName,
          studentQuiz.quiz.title,
          Number(studentQuiz.score || 0),
          verdictData.finalVerdict,
          verdictData.aiExplanation
        ).catch((e) => console.error("Failed to send verdict email:", e));
      } catch (e) {
        console.error("Failed to import sendVerdictEmail:", e);
      }
    }

    return NextResponse.json({ success: true, analysis: aiAnalysis });

  } catch (error) {
    console.error("AI Verdict error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
