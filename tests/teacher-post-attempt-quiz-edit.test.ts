import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const routePath = path.resolve(process.cwd(), "src/app/api/quizzes/[id]/route.ts");
const editorPath = path.resolve(process.cwd(), "src/components/teacher/proctorshield-quiz-editor.tsx");
const routeSource = fs.readFileSync(routePath, "utf8");
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
      if (name === "@/lib/quiz-access") return {};
      if (name === "@/lib/quiz-mode") return { parseQuizMode: (mode: string) => mode, InvalidQuizModeError: class extends Error {}, canChangeQuizMode: () => ({ allowed: true }) };
      if (name === "@/lib/quiz-availability") return { isQuizAvailable: () => true };
      if (name === "node:crypto") return crypto;
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

test("pre-attempt skipped invalid questions cannot inflate totalQuestions", async () => {
  const fixture = routeFixture(0);
  const response = await fixture.update({ questions: [...replacementQuestions.slice(0, 1), { questionText: "" }] });
  assert.equal(response.status, 200);
  assert.equal(fixture.currentQuestions().length, 1);
  assert.equal(fixture.quiz.totalQuestions, 1);
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
