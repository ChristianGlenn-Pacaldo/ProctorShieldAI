import { createHash, timingSafeEqual } from "node:crypto";
import jwt from "jsonwebtoken";

const RECEIPT_ISSUER = "proctorshield-ai";
const RECEIPT_AUDIENCE = "ai-quiz-create";

function receiptSecret() {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error("NEXTAUTH_SECRET must be configured with at least 32 characters");
  return secret;
}

function questionHash(questions: unknown) {
  if (!Array.isArray(questions) || questions.length === 0 || questions.length > 50) return null;

  const normalized = questions.map((rawQuestion) => {
    if (!rawQuestion || typeof rawQuestion !== "object" || Array.isArray(rawQuestion)) return null;
    const question = rawQuestion as Record<string, unknown>;
    if (typeof question.questionText !== "string") return null;
    const choices = Array.isArray(question.choices) ? question.choices : [];
    return {
      questionText: question.questionText.trim(),
      questionType: typeof question.questionType === "string" && question.questionType
        ? question.questionType : "multiple_choice",
      points: Number(question.points) || 1,
      choices: choices.filter((rawChoice) => rawChoice && typeof rawChoice.choiceText === "string" && rawChoice.choiceText.trim())
        .map((rawChoice) => ({
          choiceText: rawChoice.choiceText.trim(),
          isCorrect: Boolean(rawChoice.isCorrect),
        })),
    };
  });
  if (normalized.some((question) => question === null)) return null;
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

export function createAiQuizReceipt(teacherId: string, generatedQuestions: unknown) {
  const hash = questionHash(generatedQuestions);
  if (!hash) throw new Error("Cannot attest an empty or invalid AI question set");
  return jwt.sign({ purpose: RECEIPT_AUDIENCE, questionHash: hash }, receiptSecret(), {
    algorithm: "HS256",
    audience: RECEIPT_AUDIENCE,
    issuer: RECEIPT_ISSUER,
    subject: teacherId,
    expiresIn: "1h",
  });
}

export function verifyAiQuizReceipt(receipt: unknown, teacherId: string, questions: unknown) {
  if (typeof receipt !== "string") return false;
  const hash = questionHash(questions);
  if (!hash) return false;
  try {
    const claims = jwt.verify(receipt, receiptSecret(), {
      algorithms: ["HS256"],
      audience: RECEIPT_AUDIENCE,
      issuer: RECEIPT_ISSUER,
      subject: teacherId,
    });
    if (typeof claims === "string" || claims.purpose !== RECEIPT_AUDIENCE || typeof claims.questionHash !== "string") return false;
    const expectedHash = Buffer.from(hash, "hex");
    const receivedHash = Buffer.from(claims.questionHash, "hex");
    return expectedHash.length === receivedHash.length && timingSafeEqual(expectedHash, receivedHash);
  } catch {
    return false;
  }
}
