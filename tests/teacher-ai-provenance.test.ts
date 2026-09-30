import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import jwt from "jsonwebtoken";
import ts from "typescript";
import * as retakeEligibility from "../src/lib/retake-eligibility.ts";
import { createAiQuizReceipt, verifyAiQuizReceipt } from "../src/lib/ai-quiz-provenance.ts";
import { getQuizCreationDecision } from "../src/lib/subscription-rules.ts";

const originalSecret = process.env.NEXTAUTH_SECRET;
process.env.NEXTAUTH_SECRET = "teacher-ai-provenance-test-secret-at-least-32-characters";
test.after(() => {
  if (originalSecret === undefined) delete process.env.NEXTAUTH_SECRET;
  else process.env.NEXTAUTH_SECRET = originalSecret;
});

const generatedQuestions = [{
  questionText: "What does a router do?",
  questionType: "multiple_choice",
  points: 1,
  choices: [
    { choiceText: "Connects networks", isCorrect: true },
    { choiceText: "Prints documents", isCorrect: false },
  ],
}];
const creationPath = path.resolve(process.cwd(), "src/app/api/quizzes/route.ts");
const generationPath = path.resolve(process.cwd(), "src/app/api/ai/create/route.ts");
const editorPath = path.resolve(process.cwd(), "src/components/teacher/proctorshield-quiz-editor.tsx");

function transpile(source: string) {
  return ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
}

function responseJson(body: Record<string, unknown>, options?: { status?: number }) {
  return { body, status: options?.status ?? 200 };
}

function creationFixture(subscribed: boolean) {
  const quizzes: Array<Record<string, unknown>> = [];
  const activities: string[] = [];
  const entitlements = () => {
    const manualQuizCount = quizzes.filter((quiz) => quiz.isAiGenerated === false).length;
    return {
      isSubscribed: subscribed,
      manualQuizCount,
      manualQuizLimit: subscribed ? null : 5,
      manualQuizzesRemaining: subscribed ? null : Math.max(0, 5 - manualQuizCount),
      studentLimitPerQuiz: subscribed ? 100 : 20,
      planName: subscribed ? "Premium" : "Free Tier",
      subscriptionEndsAt: null,
    };
  };
  const transaction = {
    $executeRaw: async () => {},
    subject: { findFirst: async () => ({ id: 2 }) },
    quiz: {
      findUnique: async () => null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        quizzes.push(data);
        return { id: quizzes.length, ...data };
      },
    },
    activityLog: { create: async ({ data }: { data: { activity: string } }) => { activities.push(data.activity); } },
  };
  const prisma = {
    user: { findUnique: async () => ({ id: "teacher-1" }) },
    $transaction: async (callback: (client: typeof transaction) => Promise<unknown>) => callback(transaction),
  };
  const exports: { POST?: (request: unknown) => Promise<{ status: number; body: Record<string, unknown> }> } = {};
  vm.runInNewContext(transpile(fs.readFileSync(creationPath, "utf8")), {
    exports,
    require: (name: string) => {
      if (name === "next/server") return { after: () => {}, NextResponse: { json: responseJson } };
      if (name === "@/lib/prisma") return { __esModule: true, default: prisma };
      if (name === "@/lib/auth") return { getSession: async () => ({ role: "teacher", userId: "teacher-1", fullName: "QA Teacher" }) };
      if (name === "@/lib/teacher-entitlements") return { getTeacherEntitlements: async () => entitlements() };
      if (name === "@/lib/subscription-rules") return { getQuizCreationDecision };
      if (name === "@/lib/quiz-mode") return { parseQuizMode: () => "proctored", InvalidQuizModeError: class extends Error {} };
      if (name === "@/lib/quiz-availability") return { UNAVAILABLE_QUIZ_STATUSES: [] };
      if (name === "@/lib/retake-eligibility") return retakeEligibility;
      if (name === "@/lib/ai-quiz-provenance") return { verifyAiQuizReceipt };
      if (name === "node:crypto") return crypto;
      if (name === "@/lib/backup-write-gate" || name === "./backup-write-gate") return { withBackupWriteGate: (handler: unknown) => handler, runBackupWriteOrReject: (work: () => Promise<unknown>) => work(), runIncidentalBackupWrite: (work: () => Promise<unknown>) => work() };
      throw new Error(`Unexpected import: ${name}`);
    },
    console: { error() {} },
  }, { filename: creationPath });
  assert.ok(exports.POST);
  const create = (body: Record<string, unknown>) => exports.POST!({
    json: async () => ({ subjectName: "Computer Science", title: "Networking Quiz", questions: generatedQuestions, ...body }),
    headers: { get: () => null },
  });
  return { create, quizzes, activities, entitlements };
}

test("successful Gemini generation issues a teacher-bound receipt for returned questions", async () => {
  const exports: { POST?: (request: unknown) => Promise<{ status: number; body: Record<string, unknown> }> } = {};
  vm.runInNewContext(transpile(fs.readFileSync(generationPath, "utf8")), {
    exports,
    require: (name: string) => {
      if (name === "next/server") return { NextResponse: { json: responseJson } };
      if (name === "@google/genai") return { GoogleGenAI: class {
        models = { generateContent: async () => ({ text: JSON.stringify({ questions: generatedQuestions }) }) };
      } };
      if (name === "@/lib/maintenance") return { expireSubscriptions: async () => {} };
      if (name === "@/lib/auth") return { getSession: async () => ({ role: "teacher", userId: "teacher-1" }) };
      if (name === "@/lib/teacher-entitlements") return { getTeacherEntitlements: async () => ({ isSubscribed: true }) };
      if (name === "@/lib/security") return { consumeRateLimitGroup: async () => ({ allowed: true }), getClientIp: () => "127.0.0.1" };
      if (name === "@/lib/ai-quiz-provenance") return { createAiQuizReceipt };
      if (name === "@/lib/backup-write-gate" || name === "./backup-write-gate") return { withBackupWriteGate: (handler: unknown) => handler, runBackupWriteOrReject: (work: () => Promise<unknown>) => work(), runIncidentalBackupWrite: (work: () => Promise<unknown>) => work() };
      throw new Error(`Unexpected import: ${name}`);
    },
    process: { env: { GEMINI_API_KEY: "test-key" } },
    console: { error() {} },
  }, { filename: generationPath });
  const result = await exports.POST!({ headers: { get: () => null }, json: async () => ({ topic: "Networking", numQuestions: 1 }) });
  assert.equal(result.status, 200);
  assert.equal(result.body.success, true);
  assert.equal(verifyAiQuizReceipt(result.body.aiGenerationReceipt, "teacher-1", result.body.questions), true);
});

test("receipt verifies only the original teacher and generated question content", () => {
  const receipt = createAiQuizReceipt("teacher-1", generatedQuestions);
  const studioQuestions = generatedQuestions.map((question) => ({ ...question, timeLimitSeconds: 30, explanation: "" }));
  assert.equal(verifyAiQuizReceipt(receipt, "teacher-1", studioQuestions), true);
  assert.equal(verifyAiQuizReceipt(receipt, "teacher-2", studioQuestions), false);
  assert.equal(verifyAiQuizReceipt(receipt, "teacher-1", [{ ...generatedQuestions[0], questionText: "A manual question" }]), false);
  assert.equal(verifyAiQuizReceipt(`${receipt}tampered`, "teacher-1", studioQuestions), false);
  const claims = jwt.decode(receipt) as jwt.JwtPayload;
  const expired = jwt.sign({ purpose: claims.purpose, questionHash: claims.questionHash }, process.env.NEXTAUTH_SECRET!, {
    algorithm: "HS256", audience: "ai-quiz-create", issuer: "proctorshield-ai", subject: "teacher-1", expiresIn: -1,
  });
  assert.equal(verifyAiQuizReceipt(expired, "teacher-1", studioQuestions), false);
});

test("verified AI save is classified as AI and does not consume manual quota", async () => {
  const fixture = creationFixture(true);
  const receipt = createAiQuizReceipt("teacher-1", generatedQuestions);
  const result = await fixture.create({ aiGenerationReceipt: receipt });
  assert.equal(result.status, 201);
  assert.equal(fixture.quizzes[0].isAiGenerated, true);
  assert.match(fixture.activities[0], /^Created AI quiz:/);
  assert.equal(fixture.entitlements().manualQuizCount, 0);
});

test("ordinary manual save remains manual and counts against the manual quota", async () => {
  const fixture = creationFixture(false);
  const result = await fixture.create({});
  assert.equal(result.status, 201);
  assert.equal(fixture.quizzes[0].isAiGenerated, false);
  assert.match(fixture.activities[0], /^Created manual quiz:/);
  assert.equal(fixture.entitlements().manualQuizCount, 1);
});

test("crafted AI claims without matching generation evidence make zero writes", async () => {
  const fixture = creationFixture(true);
  const receipt = createAiQuizReceipt("teacher-1", generatedQuestions);
  for (const body of [
    { isAiGenerated: true },
    { aiGenerationReceipt: "forged-token", isAiGenerated: true },
    { aiGenerationReceipt: receipt, questions: [{ ...generatedQuestions[0], questionText: "Arbitrary manual question" }] },
  ]) {
    const result = await fixture.create(body);
    assert.equal(result.status, 400);
    assert.equal(fixture.quizzes.length, 0);
    assert.equal(fixture.activities.length, 0);
  }
});

test("a valid generation receipt cannot bypass the Free Teacher Pro entitlement", async () => {
  const fixture = creationFixture(false);
  const receipt = createAiQuizReceipt("teacher-1", generatedQuestions);
  const result = await fixture.create({ aiGenerationReceipt: receipt });
  assert.equal(result.status, 403);
  assert.equal(result.body.code, "SUBSCRIPTION_REQUIRED");
  assert.equal(fixture.quizzes.length, 0);
  assert.equal(fixture.activities.length, 0);
});

test("Studio includes generation evidence only for a new quiz save", async () => {
  const source = fs.readFileSync(editorPath, "utf8");
  const file = ts.createSourceFile(editorPath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback: string | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "handleSaveAndPublish"
      && node.initializer && ts.isArrowFunction(node.initializer)) callback = node.initializer.getText(file);
    ts.forEachChild(node, visit);
  };
  visit(file);
  assert.ok(callback);
  for (const id of [undefined, 7]) {
    let requestBody: Record<string, unknown> | undefined;
    const exports: { save?: () => Promise<void> } = {};
    vm.runInNewContext(transpile(`exports.save = ${callback};`), {
      exports,
      quizForm: {
        id, aiGenerationReceipt: "signed-receipt", title: "Networking Quiz", subjectName: "Computer Science", description: "",
        duration: 30, passingScore: 70, shuffleQuestions: true, allowRetake: false,
        isGamified: false, quizMode: "proctored", questions: generatedQuestions,
      },
      isContentLocked: false, isDurationLocked: false,
      setIsSaving() {}, setSaveError() {}, onSaveSuccess() {},
      fetch: async (_url: string, request: { body: string }) => {
        requestBody = JSON.parse(request.body);
        return { ok: true, json: async () => ({ success: true, quiz: { id: 7 } }) };
      },
      console: { error() {} },
    });
    await exports.save!();
    assert.equal(requestBody?.aiGenerationReceipt, id === undefined ? "signed-receipt" : undefined);
  }
});
