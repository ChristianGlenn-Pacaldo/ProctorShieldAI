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
      model: "gemini-2.0-flash",
      contents: [
        {
          role: "user",
          parts: [
            {
              inlineData: {
                mimeType: "image/jpeg",
                data: base64Data,
              },
            },
            {
              text: `You are a strict online exam proctoring AI system. Analyze this webcam image of a student taking an exam. Check for these violations ONLY:

1. "no_face" - No human face is visible in the frame at all
2. "multiple_faces" - More than one person/face is visible
3. "looking_away" - The person is clearly looking far away from the screen (turned head significantly to the side or looking up/down away from monitor)
4. "device_detected" - A cellphone, tablet, second laptop, or any electronic device other than the exam computer is visible in the frame

IMPORTANT RULES:
- Only report clear, obvious violations. Do NOT report false positives.
- A person looking slightly off-center is NOT "looking_away". They must be clearly turned away.
- Only report "device_detected" if you can clearly see a phone, tablet, or other device.
- If the person is facing the camera normally with no issues, return an empty array.

Respond with ONLY a valid JSON array of violation type strings. Examples:
- No violations: []
- Face turned away with phone visible: ["looking_away", "device_detected"]
- Nobody in frame: ["no_face"]
- Two people visible: ["multiple_faces"]

Return ONLY the JSON array, nothing else.`,
            },
          ],
        },
      ],
    });

    const text = response?.text?.trim() || "[]";
    
    // Parse the response - extract JSON array
    let violations: string[] = [];
    try {
      // Try to extract JSON from the response
      const jsonMatch = text.match(/\[.*\]/s);
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
  } catch (error: any) {
    console.error("AI analysis error:", error?.message || error);
    // On error, return no violations (fail-open to avoid false positives)
    return NextResponse.json({ violations: [] });
  }
}
