import { GoogleGenAI } from "@google/genai";

/**
 * Executes a Gemini AI request with an automatic multi-model fallback chain.
 * If one model hits a 429 rate limit or quota error, it automatically falls back
 * to the next currently supported model in the configured fallback chain.
 */
export async function generateGeminiWithFallback(prompt: string, jsonMode: boolean = true): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured in environment variables");
  }

  const ai = new GoogleGenAI({ apiKey });

  const models = Array.from(new Set([
    process.env.GEMINI_MODEL?.trim(),
    "gemini-3.6-flash",
    "gemini-3.5-flash",
  ].filter((model): model is string => Boolean(model))));
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
