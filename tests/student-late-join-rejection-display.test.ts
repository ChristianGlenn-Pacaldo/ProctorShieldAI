import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const pageSource = fs.readFileSync(path.resolve(process.cwd(), "src/app/quiz/[id]/page.tsx"), "utf8");
const sourceFile = ts.createSourceFile("page.tsx", pageSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function callbackFor(name: string): string {
  let callback: string | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && node.expression.name.text === "bind" && node.arguments[0]
      && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === name
      && node.arguments[1] && ts.isArrowFunction(node.arguments[1])) {
      callback = node.arguments[1].getText(sourceFile);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  assert.ok(callback, `${name} callback must exist`);
  return callback;
}

function loadQuizCallback(): string {
  let callback: string | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)
      && node.name.text === "loadQuiz" && node.initializer && ts.isArrowFunction(node.initializer)) {
      callback = node.initializer.getText(sourceFile);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  assert.ok(callback, "loadQuiz callback must exist");
  return callback;
}

function runCallback(source: string, context: Record<string, unknown>) {
  const code = ts.transpileModule(`exports.callback = ${source};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports: { callback?: (data?: unknown) => Promise<void> | void } = {};
  vm.runInNewContext(code, { exports, ...context });
  assert.ok(exports.callback);
  return exports.callback;
}

function approvalFixture(initialError = "") {
  const state = { status: "pending_approval", canEnter: false, error: initialError };
  const callback = runCallback(callbackFor("approval-status"), {
    quizId: "46",
    setStudentQuizStatus: (status: string) => { state.status = status; },
    setCanEnterQuiz: (allowed: boolean) => { state.canEnter = allowed; },
    setQuizError: (error: string) => { state.error = error; },
  });
  return { state, callback };
}

test("realtime rejection selects the rejected banner without turning it into a load error", () => {
  const { state, callback } = approvalFixture();
  callback({ quizId: 46, status: "rejected" });
  assert.equal(state.status, "rejected");
  assert.equal(state.canEnter, false);
  assert.equal(state.error, "");
  assert.match(pageSource, /: quizError \? \([\s\S]*?Failed to Load Quiz/);
  assert.match(pageSource, /studentQuizStatus === "rejected" \? \([\s\S]*?Late Entry Request Rejected/);
});

test("reloading a persisted rejection still selects the rejected state", async () => {
  const state = { status: "", canEnter: true, error: "" };
  const callback = runCallback(loadQuizCallback(), {
    quizId: "46", cancelled: false, hasAuthorizedQuizRef: { current: false },
    fetch: async () => ({ ok: true, json: async () => ({
      success: true, quiz: { quizMode: "proctored", duration: 30 },
      studentQuizStatus: "rejected", canEnterQuiz: false,
    }) }),
    router: { replace() {} },
    setQuiz() {}, setQuestions() {}, setStudentQuizId() {}, setUserId() {},
    setStudentQuizStatus: (status: string) => { state.status = status; },
    setCanEnterQuiz: (allowed: boolean) => { state.canEnter = allowed; },
    setQuizError: (error: string) => { state.error = error; },
    setLoadingQuiz() {}, setTimeLeft() {}, restoreSavedAnswers() {},
  });
  await callback();
  assert.deepEqual(state, { status: "rejected", canEnter: false, error: "" });
});

test("realtime approval keeps the existing admission flow", () => {
  const { state, callback } = approvalFixture();
  callback({ quizId: 46, status: "enrolled" });
  assert.equal(state.status, "enrolled");
  assert.equal(state.canEnter, false);
  assert.equal(state.error, "");
  callback({ quizId: 47, status: "rejected" });
  assert.equal(state.status, "enrolled");
});

test("realtime rejection does not clear an unrelated existing quiz error", () => {
  const { state, callback } = approvalFixture("Quiz unavailable");
  callback({ quizId: 46, status: "rejected" });
  assert.equal(state.status, "rejected");
  assert.equal(state.error, "Quiz unavailable");
});

test("unrelated quiz-loading errors still use the generic error view", async () => {
  const errors: string[] = [];
  const callback = runCallback(loadQuizCallback(), {
    quizId: "46", cancelled: false, hasAuthorizedQuizRef: { current: false },
    fetch: async () => ({ ok: false, json: async () => ({ error: "Quiz unavailable" }) }),
    setQuizError: (error: string) => { errors.push(error); },
    setLoadingQuiz() {},
  });
  await callback();
  assert.deepEqual(errors, ["Quiz unavailable"]);
  assert.match(pageSource, /: quizError \? \([\s\S]*?Failed to Load Quiz/);
});
