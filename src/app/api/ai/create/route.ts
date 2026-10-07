import { withBackupWriteGate } from "@/lib/backup-write-gate";
import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { expireSubscriptions } from "@/lib/maintenance";
import { getSession } from "@/lib/auth";
import { getTeacherEntitlements } from "@/lib/teacher-entitlements";
import { consumeRateLimitGroup, getClientIp } from "@/lib/security";
import { createAiQuizReceipt } from "@/lib/ai-quiz-provenance";

const AI_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

async function POSTImpl(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session || session.role !== "teacher") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const rateLimit = await consumeRateLimitGroup(
      [`ai-create:user:${session.userId}`, `ai-create:ip:${getClientIp(req)}`],
      10,
      60 * 60_000,
    );
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "AI generation limit reached. Please try again later." },
        { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
      );
    }
    const contentLength = Number(req.headers.get("content-length") || 0);
    if (Number.isFinite(contentLength) && contentLength > 6_000_000) {
      return NextResponse.json({ error: "AI request is too large" }, { status: 413 });
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
    const sourceText = typeof body.sourceText === "string" ? body.sourceText.trim() : "";
    if (sourceText.length > 60_000) return NextResponse.json({ error: "Source text is too long" }, { status: 413 });
    const requestedQuestions = Number(numQuestions ?? 5);
    const normalizedTopic = typeof topic === "string" ? topic.trim() : "";
    const hasImage = typeof imageBase64 === "string" && imageBase64.length > 0;
    if (!Number.isInteger(requestedQuestions) || requestedQuestions < 1 || requestedQuestions > 50) {
      return NextResponse.json({ error: "numQuestions must be between 1 and 50" }, { status: 400 });
    }
    if (normalizedTopic.length > 2_000) {
      return NextResponse.json({ error: "Topic is too long" }, { status: 400 });
    }
    if (hasImage && (
      imageBase64.length > 5_500_000
      || typeof mimeType !== "string"
      || !AI_IMAGE_TYPES.has(mimeType)
      || !/^[A-Za-z0-9+/=]+$/.test(imageBase64)
    )) {
      return NextResponse.json({ error: "Invalid or oversized source image" }, { status: 413 });
    }
    if (hasImage && mimeType === "application/pdf" && !Buffer.from(imageBase64, "base64").subarray(0, 5).equals(Buffer.from("%PDF-"))) {
      return NextResponse.json({ error: "Invalid PDF document" }, { status: 400 });
    }
    if (!hasImage && !normalizedTopic && !sourceText) {
      return NextResponse.json({ error: "Provide a topic or source image" }, { status: 400 });
    }

    let prompt = `You are an expert quiz creator. `;
    if (hasImage) {
      prompt += `Analyze this source document or image (which could be syllabus, notes, or a past quiz) and extract the key concepts. `;
    } else {
      prompt += `The topic or source text is: "${sourceText || normalizedTopic}". `;
    }

    prompt += `Generate ${requestedQuestions} multiple-choice questions based on the material.
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
    if (hasImage) {
      contents.push({
        inlineData: {
          data: imageBase64,
          mimeType: mimeType || "image/jpeg",
        },
      });
    }
    contents.push(prompt);

    const response = await ai.models.generateContent({
      model: process.env.GEMINI_MODEL?.trim() || "gemini-3.6-flash",
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
      console.error("Failed to parse Gemini output");
      return NextResponse.json({ error: "Invalid format returned by AI" }, { status: 500 });
    }

    const generatedQuestions = Array.isArray(aiData.questions) ? aiData.questions.slice(0, 50) : [];
    if (generatedQuestions.length === 0 || generatedQuestions.some((q: any) => !q || typeof q.questionText !== "string" || !q.questionText.trim()
      || q.questionText.length > 5000 || !Array.isArray(q.choices) || (q.choices.length < 2 || q.choices.length > 6)
      || q.choices.some((c: any) => !c || typeof c.choiceText !== "string" || !c.choiceText.trim() || c.choiceText.length > 2000 || typeof c.isCorrect !== "boolean")
      || q.choices.filter((c: any) => c.isCorrect).length !== 1)) {
      return NextResponse.json({ error: "AI did not return usable questions" }, { status: 502 });
    }
    const detectedTitle = aiData.detectedTitle || "";
    const detectedSubject = aiData.detectedSubject || "";
    const detectedDescription = aiData.detectedDescription || "";

    return NextResponse.json({
      success: true,
      questions: generatedQuestions,
      aiGenerationReceipt: createAiQuizReceipt(session.userId, generatedQuestions),
      detectedTitle,
      detectedSubject,
      detectedDescription
    });

  } catch (error: unknown) {
    console.error("AI Create request failed");
    return NextResponse.json({ error: "Failed to generate questions. Please try again." }, { status: 500 });
  }
}

export const POST = withBackupWriteGate(POSTImpl);
