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

    const { studentExamId } = await req.json();
    if (!studentExamId) {
      return NextResponse.json({ error: "studentExamId is required" }, { status: 400 });
    }

    // Fetch the exam session and its violations
    const studentExam = await prisma.studentExam.findUnique({
      where: { id: studentExamId },
      include: {
        exam: true,
        violations: true,
      },
    });

    if (!studentExam) {
      return NextResponse.json({ error: "Exam session not found" }, { status: 404 });
    }

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    // Prepare the violation summary for the AI
    const violations = studentExam.violations;
    const violationSummary = violations.map(v => 
      `- ${v.violationType} (Confidence: ${v.confidenceScore}%) at ${v.timestamp.toISOString()}`
    ).join("\n");

    const prompt = `You are ProctorShield AI, an advanced cheating detection system.
    Analyze the following exam session for a student taking an exam titled "${studentExam.exam.title}".
    
    Exam Session Data:
    - Duration: ${studentExam.exam.duration} minutes
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
      where: { studentExamId },
      update: {
        totalViolations: violations.length,
        cheatingProbability: verdictData.cheatingProbability,
        riskLevel: verdictData.riskLevel,
        finalVerdict: verdictData.finalVerdict,
        aiExplanation: verdictData.aiExplanation,
      },
      create: {
        studentExamId,
        totalViolations: violations.length,
        cheatingProbability: verdictData.cheatingProbability,
        riskLevel: verdictData.riskLevel,
        finalVerdict: verdictData.finalVerdict,
        aiExplanation: verdictData.aiExplanation,
      },
    });

    // Update the studentExam status
    await prisma.studentExam.update({
      where: { id: studentExamId },
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
