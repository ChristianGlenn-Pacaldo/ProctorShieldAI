import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";

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
        violations: true,
      },
    });

    if (!studentQuiz) {
      return NextResponse.json({ error: "Quiz session not found" }, { status: 404 });
    }

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

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

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
      },
    });

    if (!response.text) {
      return NextResponse.json({ error: "Failed to generate verdict" }, { status: 500 });
    }

    let verdictData;
    try {
      verdictData = JSON.parse(response.text);
    } catch (parseError) {
      return NextResponse.json({ error: "Invalid format returned by AI" }, { status: 500 });
    }

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

    return NextResponse.json({ success: true, analysis: aiAnalysis });

  } catch (error) {
    console.error("AI Verdict error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
