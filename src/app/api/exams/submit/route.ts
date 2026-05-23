import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { GoogleGenAI } from "@google/genai";
import { pusherServer } from "@/lib/pusher";

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session || session.role !== "student") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { examId, answers } = await req.json();
    if (!examId) {
      return NextResponse.json({ error: "examId is required" }, { status: 400 });
    }

    // 1. Find the studentExam record
    const studentExam = await prisma.studentExam.findFirst({
      where: {
        studentId: session.userId,
        examId: Number(examId),
      },
      include: {
        exam: true,
        violations: true,
      },
    });

    if (!studentExam) {
      return NextResponse.json({ error: "Exam session not found" }, { status: 404 });
    }

    // 2. Dynamic Grading and Saving Answers
    const dbQuestions = await prisma.question.findMany({
      where: { examId: Number(examId) },
      include: { choices: true }
    });

    let score = 0;
    if (dbQuestions.length > 0) {
      let totalPoints = 0;
      let earnedPoints = 0;
      for (const q of dbQuestions) {
        totalPoints += q.points;
        const submitted = answers?.find((a: any) => a.questionId === q.id);
        const correctChoice = q.choices.find(c => c.isCorrect);
        const isCorrect = submitted && correctChoice && submitted.choiceId === correctChoice.id;
        if (isCorrect) {
          earnedPoints += q.points;
        }
      }
      score = totalPoints > 0 ? Math.round((earnedPoints / totalPoints) * 100) : 0;

      // Save student answers to the database
      if (answers && answers.length > 0) {
        try {
          await prisma.answer.deleteMany({
            where: { studentExamId: studentExam.id }
          });

          await prisma.answer.createMany({
            data: answers.map((a: any) => {
              const q = dbQuestions.find(dq => dq.id === a.questionId);
              const correctChoice = q?.choices.find(c => c.isCorrect);
              const isCorrect = q && correctChoice && a.choiceId === correctChoice.id;
              return {
                studentExamId: studentExam.id,
                questionId: a.questionId,
                pointsEarned: isCorrect ? q.points : 0,
                isCorrect: isCorrect,
                answerText: String(a.choiceId)
              };
            })
          });
        } catch (err) {
          console.error("Failed to save student answers:", err);
        }
      }
    } else {
      // Fallback for legacy/mock exams
      score = Math.floor(75 + Math.random() * 25);
    }

    // 3. AI Verdict Logic (Gemini with Robust Fallback)
    const violations = studentExam.violations;
    const violationSummary = violations.map(v => 
      `- ${v.violationType} (Confidence: ${v.confidenceScore}%) at ${v.timestamp.toISOString()}`
    ).join("\n");

    let verdictData = {
      cheatingProbability: 3,
      riskLevel: "low",
      finalVerdict: "clean",
      aiExplanation: "No anomalies detected during the exam session. Student maintained focus.",
    };

    if (violations.length === 1) {
      verdictData = {
        cheatingProbability: 35,
        riskLevel: "medium",
        finalVerdict: "suspicious",
        aiExplanation: "A single proctoring anomaly was recorded. Instructors should review the snapshot log.",
      };
    } else if (violations.length >= 2) {
      verdictData = {
        cheatingProbability: 85,
        riskLevel: "high",
        finalVerdict: "cheated",
        aiExplanation: `Multiple integrity violations (${violations.length}) were flagged during the exam. Combined patterns strongly suggest external assistance.`,
      };
    }

    // If Gemini key exists, call Gemini for dynamic analysis
    if (process.env.GEMINI_API_KEY) {
      try {
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
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

        if (response.text) {
          const parsed = JSON.parse(response.text.trim());
          if (parsed && parsed.finalVerdict) {
            verdictData = parsed;
          }
        }
      } catch (geminiError) {
        console.warn("Gemini verdict call failed, using fallback:", geminiError);
      }
    }

    // 4. Save AI Analysis Verdict to Database
    await prisma.aiAnalysis.upsert({
      where: { studentExamId: studentExam.id },
      update: {
        totalViolations: violations.length,
        cheatingProbability: verdictData.cheatingProbability,
        riskLevel: verdictData.riskLevel,
        finalVerdict: verdictData.finalVerdict,
        aiExplanation: verdictData.aiExplanation,
      },
      create: {
        studentExamId: studentExam.id,
        totalViolations: violations.length,
        cheatingProbability: verdictData.cheatingProbability,
        riskLevel: verdictData.riskLevel,
        finalVerdict: verdictData.finalVerdict,
        aiExplanation: verdictData.aiExplanation,
      },
    });

    // 5. Update StudentExam Status and Verdict
    const updatedStudentExam = await prisma.studentExam.update({
      where: { id: studentExam.id },
      data: {
        endTime: new Date(),
        examStatus: "completed",
        score: score,
        aiVerdict: verdictData.finalVerdict,
        cheatingProbability: verdictData.cheatingProbability,
      },
    });

    // 6. Broadcast student-submitted event via Pusher
    const channelName = `teacher-${studentExam.exam.teacherId}`;
    try {
      await pusherServer.trigger(channelName, "student-submitted", {
        studentId: session.userId,
        studentName: session.fullName,
        examId: studentExam.exam.id,
        examTitle: studentExam.exam.title,
        aiVerdict: verdictData.finalVerdict,
        cheatingProbability: verdictData.cheatingProbability,
        score: score,
        timestamp: new Date().toISOString(),
      });

      // Broadcast to admin dashboard
      await pusherServer.trigger("admin-dashboard", "activity", {
        type: "exam-submit",
        userId: session.userId,
        fullName: session.fullName,
        role: "student",
        activity: `Exam completed: ${studentExam.exam.title} by ${session.fullName}`,
        timestamp: new Date().toISOString(),
      });
    } catch (pusherErr) {
      console.error("Pusher submit broadcast error:", pusherErr);
    }

    return NextResponse.json({
      success: true,
      studentExam: updatedStudentExam,
    });

  } catch (error) {
    console.error("Submit exam error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
