import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as retakeEligibility from "../src/lib/retake-eligibility.ts";

const routePath = path.resolve(process.cwd(), "src/app/api/quizzes/[id]/route.ts");
const creationPath = path.resolve(process.cwd(), "src/app/api/quizzes/route.ts");
const editorPath = path.resolve(process.cwd(), "src/components/teacher/proctorshield-quiz-editor.tsx");
const routeSource = fs.readFileSync(routePath, "utf8");
const creationSource = fs.readFileSync(creationPath, "utf8");
const editorSource = fs.readFileSync(editorPath, "utf8");

function transpile(source: string) {
  return ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
}

function routeFixture(attemptCount: number, quizStatus = "active") {
  const quiz = {
    id: 7, teacherId: "teacher-1", subjectId: 2, quizStatus, quizMode: "proctored",
    title: "Original", description: "Original description", duration: 30, passingScore: 70,
    shuffleQuestions: false, allowRetake: false, isGamified: false, totalQuestions: 1,
  };
  let subject = { id: 2, subjectName: "Computer Science" };
  let questions = [{ questionText: "Original question", choices: ["Yes", "No"] }];
  const writes: string[] = [];
  const transaction = {
    studentQuiz: { count: async () => attemptCount },
    subject: {
      findUnique: async () => subject,
      findFirst: async ({ where }: { where: { subjectName: { equals: string } } }) =>
        where.subjectName.equals.toLowerCase() === subject.subjectName.toLowerCase() ? subject : null,
      create: async ({ data }: { data: { subjectName: string } }) => {
        writes.push("subject.create");
        subject = { id: 3, subjectName: data.subjectName };
        return subject;
      },
    },
    choice: { deleteMany: async () => { writes.push("choice.deleteMany"); } },
    question: {
      deleteMany: async () => { writes.push("question.deleteMany"); questions = []; },
      create: async ({ data }: { data: { questionText: string; choices: { create: Array<{ choiceText: string }> } } }) => {
        writes.push("question.create");
        questions.push({ questionText: data.questionText, choices: data.choices.create.map((choice) => choice.choiceText) });
      },
    },
    setting: { upsert: async () => { writes.push("setting.upsert"); } },
    quiz: { update: async ({ data }: { data: Record<string, unknown> }) => {
      writes.push("quiz.update");
      Object.assign(quiz, data);
      return { ...quiz, subject, questions };
    } },
  };
  const prisma = {
    quiz: { findUnique: async () => ({ ...quiz }) },
    studentQuiz: { count: async () => attemptCount },
    $transaction: async (callback: (client: typeof transaction) => Promise<unknown>) => callback(transaction),
  };
  const exports: { PUT?: (request: unknown, context: unknown) => Promise<{ status: number; body: Record<string, unknown> }> } = {};
  vm.runInNewContext(transpile(routeSource), {
    exports,
    require: (name: string) => {
      if (name === "next/server") return { NextResponse: { json: (body: Record<string, unknown>, options?: { status?: number }) => ({ body, status: options?.status ?? 200 }) } };
      if (name === "@/lib/prisma") return { __esModule: true, default: prisma };
      if (name === "@/lib/auth") return { getSession: async () => ({ role: "teacher", userId: "teacher-1" }) };
      if (name === "@/lib/arena") return { mutateArena: () => { throw new Error("Proctored edit must keep its original transaction path"); } };
      if (name === "@/lib/quiz-access") return {};
      if (name === "@/lib/quiz-mode") return { parseQuizMode: (mode: string) => mode, InvalidQuizModeError: class extends Error {}, canChangeQuizMode: () => ({ allowed: true }) };
      if (name === "@/lib/quiz-availability") return { isQuizAvailable: () => true };
      if (name === "node:crypto") return crypto;
      if (name === "@/lib/backup-write-gate" || name === "./backup-write-gate") return { withBackupWriteGate: (handler: unknown) => handler, runBackupWriteOrReject: (work: () => Promise<unknown>) => work(), runIncidentalBackupWrite: (work: () => Promise<unknown>) => work() };
      throw new Error(`Unexpected import: ${name}`);
    },
    console: { error() {} },
  });
  assert.ok(exports.PUT);
  const update = (body: Record<string, unknown>) => exports.PUT!({ json: async () => body }, { params: Promise.resolve({ id: "7" }) });
  return { update, writes, quiz, currentQuestions: () => questions, currentSubject: () => subject };
}

const replacementQuestions = [
  { questionText: "Changed question", points: 1, questionType: "multiple_choice", choices: [
    { choiceText: "Yes", isCorrect: true }, { choiceText: "No", isCorrect: false },
  ] },
  { questionText: "Second question", points: 1, questionType: "multiple_choice", choices: [
    { choiceText: "A", isCorrect: true }, { choiceText: "B", isCorrect: false },
  ] },
];

test("post-attempt question edits are rejected without changing questions or totalQuestions", async () => {
  const fixture = routeFixture(1);
  const response = await fixture.update({ questions: replacementQuestions, totalQuestions: 2 });
  assert.equal(response.status, 409);
  assert.equal(response.body.code, "QUIZ_CONTENT_LOCKED");
  assert.match(String(response.body.error), /Questions cannot be changed/);
  assert.deepEqual(fixture.writes, []);
  assert.equal(fixture.quiz.totalQuestions, 1);
  assert.equal(fixture.currentQuestions().length, 1);
});

test("post-attempt subject edits are rejected without writes", async () => {
  const fixture = routeFixture(1);
  const response = await fixture.update({ subjectName: "Mathematics" });
  assert.equal(response.status, 409);
  assert.match(String(response.body.error), /Subject cannot be changed/);
  assert.deepEqual(fixture.writes, []);
  assert.equal(fixture.quiz.subjectId, 2);
});

test("mixed metadata and forbidden content edits cannot partially apply", async () => {
  const fixture = routeFixture(1);
  const response = await fixture.update({ title: "New title", subjectName: "Mathematics", questions: replacementQuestions });
  assert.equal(response.status, 409);
  assert.deepEqual(fixture.writes, []);
  assert.equal(fixture.quiz.title, "Original");
  assert.equal(fixture.quiz.totalQuestions, 1);
});

test("post-attempt metadata-only edit keeps stored questions and totalQuestions", async () => {
  const fixture = routeFixture(1, "in_progress");
  const response = await fixture.update({ title: "Updated title", description: "Updated description", allowRetake: true });
  assert.equal(response.status, 200);
  assert.deepEqual(fixture.writes, ["quiz.update"]);
  assert.equal(fixture.quiz.title, "Updated title");
  assert.equal(fixture.quiz.totalQuestions, 1);
  assert.equal(fixture.currentQuestions().length, 1);
});

test("post-attempt totalQuestions cannot be changed without rewriting questions", async () => {
  const fixture = routeFixture(1);
  const response = await fixture.update({ title: "New title", totalQuestions: 2 });
  assert.equal(response.status, 409);
  assert.deepEqual(fixture.writes, []);
  assert.equal(fixture.quiz.totalQuestions, 1);
  assert.equal(fixture.quiz.title, "Original");
});

test("unchanged subject can accompany a post-attempt metadata edit", async () => {
  const fixture = routeFixture(1);
  const response = await fixture.update({ title: "New title", subjectName: "Computer Science" });
  assert.equal(response.status, 200);
  assert.deepEqual(fixture.writes, ["quiz.update"]);
  assert.equal(fixture.quiz.subjectId, 2);
});

test("pre-attempt question and subject edits persist and count created rows", async () => {
  const fixture = routeFixture(0);
  const response = await fixture.update({ subjectName: "Mathematics", questions: replacementQuestions });
  assert.equal(response.status, 200);
  assert.equal(fixture.currentQuestions().length, 2);
  assert.equal(fixture.quiz.totalQuestions, 2);
  assert.equal(fixture.quiz.subjectId, 3);
  assert.equal(fixture.currentSubject().subjectName, "Mathematics");
});

test("pre-attempt invalid questions cannot replace existing rows or totalQuestions", async () => {
  const fixture = routeFixture(0);
  const response = await fixture.update({ questions: [...replacementQuestions.slice(0, 1), { questionText: "" }] });
  assert.equal(response.status, 400);
  assert.equal(response.body.code, "INVALID_QUIZ_QUESTIONS");
  assert.deepEqual(fixture.writes, []);
  assert.equal(fixture.currentQuestions().length, 1);
  assert.equal(fixture.quiz.totalQuestions, 1);
});

const validQuestion = replacementQuestions[0];
const invalidQuestionCases = [
  { name: "empty question set", questions: [] },
  { name: "too many questions", questions: Array.from({ length: 101 }, () => validQuestion) },
  { name: "blank question text", questions: [validQuestion, { ...validQuestion, questionText: "  " }] },
  { name: "oversized question text", questions: [{ ...validQuestion, questionText: "x".repeat(2_001) }] },
  { name: "missing choices", questions: [{ ...validQuestion, choices: undefined }] },
  { name: "one multiple-choice answer", questions: [{ ...validQuestion, choices: validQuestion.choices.slice(0, 1) }] },
  { name: "blank answer text", questions: [{ ...validQuestion, choices: [{ ...validQuestion.choices[0], choiceText: "  " }, validQuestion.choices[1]] }] },
  { name: "oversized answer text", questions: [{ ...validQuestion, choices: [{ ...validQuestion.choices[0], choiceText: "x".repeat(1_001) }, validQuestion.choices[1]] }] },
  { name: "no correct answer", questions: [{ ...validQuestion, choices: validQuestion.choices.map((choice) => ({ ...choice, isCorrect: false })) }] },
  { name: "multiple correct answers", questions: [{ ...validQuestion, choices: validQuestion.choices.map((choice) => ({ ...choice, isCorrect: true })) }] },
  { name: "true-false with one answer", questions: [{ ...validQuestion, questionType: "true_false", choices: validQuestion.choices.slice(0, 1) }] },
  { name: "fill-in-blank without a correct answer", questions: [{ ...validQuestion, questionType: "fill_in_blank", choices: [{ choiceText: "answer", isCorrect: false }] }] },
  { name: "zero points", questions: [{ ...validQuestion, points: 0 }] },
  { name: "points above 100", questions: [{ ...validQuestion, points: 101 }] },
  { name: "fractional points", questions: [{ ...validQuestion, points: 1.5 }] },
  { name: "nonnumeric points", questions: [{ ...validQuestion, points: "five" }] },
];

for (const { name, questions } of invalidQuestionCases) {
  test(`invalid edited questions: ${name} returns 400 before any write`, async () => {
    const fixture = routeFixture(0);
    const storedQuestions = JSON.stringify(fixture.currentQuestions());
    const response = await fixture.update({ title: "Should not save", subjectName: "Mathematics", questions });
    assert.equal(response.status, 400);
    assert.equal(response.body.code, "INVALID_QUIZ_QUESTIONS");
    assert.match(String(response.body.error), /question|answer|points/i);
    assert.deepEqual(fixture.writes, []);
    assert.equal(JSON.stringify(fixture.currentQuestions()), storedQuestions);
    assert.equal(fixture.quiz.totalQuestions, 1);
    assert.equal(fixture.quiz.title, "Original");
    assert.equal(fixture.quiz.subjectId, 2);
  });
}

test("valid fill-in-blank replacement keeps its single correct answer", async () => {
  const fixture = routeFixture(0);
  const response = await fixture.update({ questions: [{
    questionText: "Capital of France?", questionType: "fill_in_blank", points: 2,
    choices: [{ choiceText: "Paris", isCorrect: true }],
  }] });
  assert.equal(response.status, 200);
  assert.equal(fixture.currentQuestions().length, 1);
  assert.equal(fixture.quiz.totalQuestions, 1);
  assert.deepEqual(fixture.writes, ["choice.deleteMany", "question.deleteMany", "question.create", "quiz.update"]);
});

test("post-attempt content lock still takes precedence over invalid edited questions", async () => {
  const fixture = routeFixture(1);
  const response = await fixture.update({ questions: [{ questionText: "" }] });
  assert.equal(response.status, 409);
  assert.equal(response.body.code, "QUIZ_CONTENT_LOCKED");
  assert.deepEqual(fixture.writes, []);
});

function creationFixture() {
  let createdQuestions: unknown[] | undefined;
  const entitlements = { manualQuizCount: 0, manualQuizLimit: 5 };
  const transaction = {
    $executeRaw: async () => {},
    subject: { findFirst: async () => ({ id: 2 }) },
    quiz: {
      findUnique: async () => null,
      create: async ({ data }: { data: { questions: { create: unknown[] } } }) => {
        createdQuestions = data.questions.create;
        return { id: 7 };
      },
    },
    activityLog: { create: async () => {} },
  };
  const prisma = {
    user: { findUnique: async () => ({ id: "teacher-1" }) },
    $transaction: async (callback: (client: typeof transaction) => Promise<unknown>) => callback(transaction),
  };
  const exports: { POST?: (request: unknown) => Promise<{ status: number; body: Record<string, unknown> }> } = {};
  vm.runInNewContext(transpile(creationSource), {
    exports,
    require: (name: string) => {
      if (name === "next/server") return { after: () => {}, NextResponse: { json: (body: Record<string, unknown>, options?: { status?: number }) => ({ body, status: options?.status ?? 200 }) } };
      if (name === "@/lib/prisma") return { __esModule: true, default: prisma };
      if (name === "@/lib/auth") return { getSession: async () => ({ role: "teacher", userId: "teacher-1" }) };
      if (name === "@/lib/teacher-entitlements") return { getTeacherEntitlements: async () => entitlements };
      if (name === "@/lib/subscription-rules") return { getQuizCreationDecision: () => ({ allowed: true }) };
      if (name === "@/lib/quiz-mode") return { parseQuizMode: () => "proctored", InvalidQuizModeError: class extends Error {} };
      if (name === "@/lib/quiz-availability") return { UNAVAILABLE_QUIZ_STATUSES: [] };
      if (name === "@/lib/retake-eligibility") return retakeEligibility;
      if (name === "@/lib/ai-quiz-provenance") return { verifyAiQuizReceipt: () => false };
      if (name === "node:crypto") return crypto;
      if (name === "@/lib/backup-write-gate" || name === "./backup-write-gate") return { withBackupWriteGate: (handler: unknown) => handler, runBackupWriteOrReject: (work: () => Promise<unknown>) => work(), runIncidentalBackupWrite: (work: () => Promise<unknown>) => work() };
      throw new Error(`Unexpected import: ${name}`);
    },
    console: { error() {} },
  });
  assert.ok(exports.POST);
  const create = (questions: unknown[]) => exports.POST!({
    json: async () => ({ subjectName: "Computer Science", title: "Creation contract", questions }),
    headers: { get: () => null },
  });
  return { create, getCreatedQuestions: () => createdQuestions };
}

test("quiz creation still accepts fill-in-blank and normalizes points as before", async () => {
  const fixture = creationFixture();
  const response = await fixture.create([{
    questionText: "Capital of France?", questionType: "fill_in_blank", points: 0,
    choices: [{ choiceText: "Paris", isCorrect: true }],
  }]);
  assert.equal(response.status, 201);
  assert.equal((fixture.getCreatedQuestions() as Array<{ points: number }>)[0].points, 1);
});

test("quiz creation still rejects incomplete correct answers", async () => {
  const fixture = creationFixture();
  const response = await fixture.create([{ ...validQuestion, choices: validQuestion.choices.map((choice) => ({ ...choice, isCorrect: false })) }]);
  assert.equal(response.status, 400);
  assert.equal(fixture.getCreatedQuestions(), undefined);
});

function editorSaveCallback() {
  const sourceFile = ts.createSourceFile(editorPath, editorSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback: string | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)
      && node.name.text === "handleSaveAndPublish" && node.initializer && ts.isArrowFunction(node.initializer)) {
      callback = node.initializer.getText(sourceFile);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  assert.ok(callback);
  const exports: { save?: () => Promise<void> } = {};
  return { code: transpile(`exports.save = ${callback};`), exports };
}

async function studioSave(isContentLocked: boolean, status = 200, quizStatus = "active") {
  const { code, exports } = editorSaveCallback();
  let payload: Record<string, unknown> | undefined;
  let error: string | null = null;
  let saved = false;
  vm.runInNewContext(code, {
    exports,
    quizForm: {
      id: 7, title: "Updated title", subjectName: "Computer Science", description: "Updated",
      duration: 30, passingScore: 70, shuffleQuestions: false, allowRetake: false,
      isGamified: false, quizMode: "proctored", quizStatus, questions: replacementQuestions,
    },
    isContentLocked,
    isDurationLocked: quizStatus === "in_progress" || quizStatus === "ended",
    setIsSaving() {}, setSaveError: (message: string | null) => { error = message; },
    fetch: async (_url: string, request: { body: string }) => {
      payload = JSON.parse(request.body);
      return { ok: status === 200, status, json: async () => status === 200
        ? { success: true, quiz: { id: 7 } }
        : { code: "QUIZ_CONTENT_LOCKED", error: "Questions cannot be changed after students have joined this quiz." } };
    },
    onSaveSuccess: () => { saved = true; },
    console: { error() {} },
  });
  await exports.save!();
  return { payload, error, saved };
}

test("Studio sends only metadata after attempts and keeps content controls read-only", async () => {
  const result = await studioSave(true, 200, "in_progress");
  assert.equal(result.saved, true);
  assert.ok(result.payload);
  assert.equal(result.payload.title, "Updated title");
  assert.equal("questions" in result.payload, false);
  assert.equal("subjectName" in result.payload, false);
  assert.equal("totalQuestions" in result.payload, false);
  assert.equal("duration" in result.payload, false);
  assert.match(editorSource, /Questions and subject are read-only after students have joined/);
  assert.match(editorSource, /disabled=\{isContentLocked\}/);
});

test("Studio still sends question and subject edits before attempts", async () => {
  const result = await studioSave(false);
  assert.equal(result.saved, true);
  assert.equal(result.payload?.subjectName, "Computer Science");
  assert.equal((result.payload?.questions as unknown[]).length, 2);
  assert.equal(result.payload?.duration, 30);
});

test("Studio surfaces the server's content-lock error instead of a quiz-mode error", async () => {
  const result = await studioSave(false, 409);
  assert.equal(result.saved, false);
  assert.match(result.error || "", /Questions cannot be changed/);
  assert.doesNotMatch(result.error || "", /Quiz mode/);
});
