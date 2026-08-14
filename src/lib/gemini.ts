import { GoogleGenAI } from "@google/genai";

/**
 * Executes a Gemini AI request with an automatic multi-model fallback chain.
 * If one model hits a 429 rate limit or quota error, it automatically falls back
 * to the next model in line: gemini-2.0-flash -> gemini-1.5-flash -> gemini-1.5-pro -> gemini-2.0-flash-lite.
 */
export async function generateGeminiWithFallback(prompt: string, jsonMode: boolean = true): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured in environment variables");
  }

  const ai = new GoogleGenAI({ apiKey });

  // Priority fallback model sequence
  const models = ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-1.5-pro", "gemini-2.0-flash-lite"];
  let lastError: any = null;

  for (const model of models) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: jsonMode ? { responseMimeType: "application/json" } : undefined,
      });

      if (response && response.text) {
        return response.text;
      }
    } catch (err: any) {
      console.warn(`[Gemini AI Chain] Model "${model}" rate limited/failed. Trying next... (${err?.message || "Rate limit"})`);
      lastError = err;
    }
  }

  throw lastError || new Error("All Gemini AI models rate limited or unavailable");
}
