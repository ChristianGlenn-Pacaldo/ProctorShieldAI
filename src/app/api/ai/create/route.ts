import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { expireSubscriptions } from "@/lib/maintenance";
import { getSession } from "@/lib/auth";
import { getTeacherEntitlements } from "@/lib/teacher-entitlements";

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session || session.role !== "teacher") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    await expireSubscriptions(session.userId);

    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json({ error: "Gemini API key is not configured" }, { status: 500 });
    }

    // ── SUBSCRIPTION CHECK ──
    const entitlements = await getTeacherEntitlements(session.userId);

    if (!entitlements.isSubscribed) {
      return NextResponse.json({ 
        error: "Subscription Required", 
        code: "SUBSCRIPTION_REQUIRED",
        message: "You need an active ProctorShield AI Pro subscription to use the AI Quiz Generator.",
        entitlements,
      }, { status: 403 });
    }

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const body = await req.json();
    const { imageBase64, mimeType, topic, numQuestions } = body;

    let prompt = `You are an expert quiz creator. `;
    if (imageBase64) {
      prompt += `Analyze this image (which could be syllabus, notes, or a past quiz) and extract the key concepts. `;
    } else if (topic) {
      prompt += `The topic is: "${topic}". `;
    }

    prompt += `Generate ${numQuestions || 5} multiple-choice questions based on the material.
    Also, detect a suitable quiz title, subject name (like "Mathematics", "Biology", "Computer Science", etc.), and a short description from the material content.
    Format your response as a valid JSON object with the following fields:
    - detectedTitle: a short, specific title for the quiz based on the content (e.g. "Algebra Quiz", "Cell division Test")
    - detectedSubject: a single subject category (e.g. "Mathematics", "Science", "History", "Literature", "General Knowledge")
    - detectedDescription: a brief summary of what the quiz covers
    - questions: an array of questions, where each question has:
      - questionText (string)
      - choices (array of 4 objects, each with 'choiceText' (string) and 'isCorrect' (boolean))
    Ensure exactly one choice is correct per question. Return ONLY the raw JSON object. Do not use markdown backticks around the json.`;

    const contents = [];
    if (imageBase64) {
      contents.push({
        inlineData: {
          data: imageBase64,
          mimeType: mimeType || "image/jpeg",
        },
      });
    }
    contents.push(prompt);

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: contents,
      config: {
        responseMimeType: "application/json",
      },
    });

    if (!response.text) {
      return NextResponse.json({ error: "Failed to generate questions" }, { status: 500 });
    }

    // Since we requested JSON mimeType, response.text should be valid JSON
    let aiData: any = {};
    try {
      aiData = JSON.parse(response.text);
    } catch (parseError) {
      console.error("Failed to parse Gemini output:", response.text);
      return NextResponse.json({ error: "Invalid format returned by AI" }, { status: 500 });
    }

    const generatedQuestions = aiData.questions || [];
    const detectedTitle = aiData.detectedTitle || "";
    const detectedSubject = aiData.detectedSubject || "";
    const detectedDescription = aiData.detectedDescription || "";

    return NextResponse.json({
      success: true,
      questions: generatedQuestions,
      detectedTitle,
      detectedSubject,
      detectedDescription
    });

  } catch (error: unknown) {
    console.error("AI Create error:", error);
    return NextResponse.json({ error: "Failed to generate questions. Please try again." }, { status: 500 });
  }
}
