import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { getSession } from "@/lib/auth";

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session || session.role !== "teacher") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json({ error: "Gemini API key is not configured" }, { status: 500 });
    }

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const body = await req.json();
    const { imageBase64, mimeType, topic, numQuestions } = body;

    let prompt = `You are an expert exam creator. `;
    if (imageBase64) {
      prompt += `Analyze this image (which could be syllabus, notes, or a past quiz) and extract the key concepts. `;
    } else if (topic) {
      prompt += `The topic is: "${topic}". `;
    }

    prompt += `Generate ${numQuestions || 5} multiple-choice questions based on the material. 
    Format your response as a valid JSON array where each object has:
    - questionText (string)
    - choices (array of 4 objects, each with 'choiceText' (string) and 'isCorrect' (boolean))
    Ensure exactly one choice is correct per question. Return ONLY the raw JSON array. Do not use markdown backticks around the json.`;

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
    let generatedQuestions = [];
    try {
      generatedQuestions = JSON.parse(response.text);
    } catch (parseError) {
      console.error("Failed to parse Gemini output:", response.text);
      return NextResponse.json({ error: "Invalid format returned by AI" }, { status: 500 });
    }

    return NextResponse.json({ success: true, questions: generatedQuestions });

  } catch (error) {
    console.error("AI Create error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
