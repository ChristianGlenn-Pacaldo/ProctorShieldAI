import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session || session.role !== "student") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { snapshot } = await req.json();

    if (!snapshot) {
      return NextResponse.json({ violations: [] });
    }

    // Strip the data:image/jpeg;base64, prefix
    const base64Data = snapshot.replace(/^data:image\/\w+;base64,/, "");

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          inlineData: {
            data: base64Data,
            mimeType: "image/jpeg",
          },
        },
        `You are a strict online quiz proctoring AI system. Analyze this webcam image of a student taking an quiz. 
Your ONLY task is to check for unauthorized devices.

Check for this violation ONLY:
1. "device_detected" - A cellphone, tablet, second laptop, smart watch, or any electronic device other than the quiz computer is visible in the frame.

IMPORTANT RULES:
- Only report clear, obvious violations. Do NOT report false positives.
- A person holding a pen or scratching their face is NOT a device.
- Only report "device_detected" if you can clearly see a phone, tablet, or other device.
- If no devices are visible, return an empty array.

Respond with ONLY a valid JSON array of violation type strings. Quizples:
- No devices: []
- Phone visible: ["device_detected"]

Return ONLY the JSON array, nothing else.`
      ],
    });

    const text = response?.text?.trim() || "[]";
    
    // Parse the response - extract JSON array
    let violations: string[] = [];
    try {
      // Try to extract JSON from the response
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        violations = JSON.parse(jsonMatch[0]);
      }
    } catch {
      console.error("Failed to parse Gemini response:", text);
      violations = [];
    }

    // Filter to only valid violation types
    const validTypes = ["no_face", "multiple_faces", "looking_away", "device_detected"];
    violations = violations.filter((v: string) => validTypes.includes(v));

    return NextResponse.json({ violations });
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error("AI analysis error:", errMsg);
    // On error, return no violations (fail-open to avoid false positives)
    return NextResponse.json({ violations: [] });
  }
}
