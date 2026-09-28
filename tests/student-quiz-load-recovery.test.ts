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
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name
      && node.initializer && ts.isArrowFunction(node.initializer)) {
      callback = node.initializer.getText(sourceFile);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  assert.ok(callback, `${name} callback must exist`);
  return callback;
}

function quizLoadEffect(): string {
  let effect: string | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "useEffect"
      && node.arguments[0] && ts.isArrowFunction(node.arguments[0])
      && node.arguments[0].getText(sourceFile).includes("loadQuizRef.current = loadQuiz")) {
      effect = node.arguments[0].getText(sourceFile);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  assert.ok(effect, "quiz load effect must exist");
  return effect;
}

function runCallback(source: string, context: Record<string, unknown>) {
  const code = ts.transpileModule(`exports.callback = ${source};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports: { callback?: (...args: unknown[]) => unknown } = {};
  vm.runInNewContext(code, { exports, ...context });
  assert.ok(exports.callback);
  return exports.callback;
}

type ResponseFixture = { ok: boolean; body: Record<string, unknown> } | "network-error";

function createFixture(responses: ResponseFixture[]) {
  const state = {
    error: "", status: "", loading: true, quiz: null as Record<string, unknown> | null,
    canEnter: false, retrying: false, redirects: [] as string[], intervalCount: 0, clearedIntervals: 0,
  };
  const loadQuizRef = { current: null as null | (() => Promise<void>) };
  const hasAuthorizedQuizRef = { current: false };
  let poll: (() => void) | null = null;
  const context = {
    quizId: "46", hasStarted: false, quizSubmittedResult: null, loadQuizRef, hasAuthorizedQuizRef,
    fetch: async () => {
      const response = responses.shift();
      assert.ok(response, "unexpected quiz fetch");
      if (response === "network-error") throw new Error("offline");
      return { ok: response.ok, json: async () => response.body };
    },
    router: { replace: (destination: string) => state.redirects.push(destination) },
    setQuiz: (quiz: Record<string, unknown>) => { state.quiz = quiz; },
    setQuestions() {}, setStudentQuizId() {}, setUserId() {}, setTimeLeft() {}, restoreSavedAnswers() {},
    setStudentQuizStatus: (status: string) => { state.status = status; },
    setCanEnterQuiz: (allowed: boolean) => { state.canEnter = allowed; },
    setQuizError: (error: string) => { state.error = error; },
    setLoadingQuiz: (loading: boolean) => { state.loading = loading; },
    setIsRetryingQuiz: (retrying: boolean) => { state.retrying = retrying; },
    isRetryingQuiz: false,
    setIsMobile() {}, setMonitoringLevel() {},
    setInterval: (callback: () => void) => { state.intervalCount++; poll = callback; return 1; },
    clearInterval: () => { state.clearedIntervals++; },
  };
  const cleanup = runCallback(quizLoadEffect(), context)() as () => void;
  const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
  return {
    state, loadQuizRef, hasAuthorizedQuizRef, context, cleanup, flush,
    poll: async () => { assert.ok(poll); poll(); await flush(); },
  };
}

const authorizedQuiz = {
  success: true, quiz: { id: 46, quizMode: "proctored", duration: 30, quizStatus: "waiting" },
  studentQuizStatus: "enrolled", canEnterQuiz: false, questions: [],
};

test("failed initial load recovers from an authorized successful poll without another interval", async () => {
  const fixture = createFixture([
    { ok: false, body: { error: "Temporary server failure" } },
    { ok: true, body: authorizedQuiz },
  ]);
  await fixture.flush();
  assert.equal(fixture.state.error, "Temporary server failure");
  await fixture.poll();
  assert.equal(fixture.state.error, "");
  assert.equal(fixture.state.status, "enrolled");
  assert.equal(fixture.state.canEnter, false);
  assert.equal(fixture.state.quiz?.id, 46);
  assert.equal(fixture.state.intervalCount, 1);
  fixture.cleanup();
  assert.equal(fixture.state.clearedIntervals, 1);
});

test("explicit Retry refetches authoritative data and clears error only after success", async () => {
  const fixture = createFixture([
    "network-error",
    { ok: true, body: authorizedQuiz },
  ]);
  await fixture.flush();
  assert.equal(fixture.state.error, "Network error loading quiz");
  const retry = runCallback(callbackFor("retryQuizLoad"), fixture.context);
  retry();
  assert.equal(fixture.state.error, "Network error loading quiz");
  await fixture.flush();
  assert.equal(fixture.state.error, "");
  assert.equal(fixture.state.retrying, false);
  assert.equal(fixture.state.intervalCount, 1);
  assert.match(pageSource, /onClick=\{retryQuizLoad\}/);
  fixture.cleanup();
});

test("repeated server and network failures keep the generic error visible", async () => {
  const fixture = createFixture([
    { ok: false, body: { error: "Server unavailable" } },
    "network-error",
    { ok: false, body: { error: "Server unavailable" } },
  ]);
  await fixture.flush();
  await fixture.poll();
  assert.equal(fixture.state.error, "Server unavailable");
  await fixture.loadQuizRef.current?.();
  assert.equal(fixture.state.error, "Server unavailable");
  assert.equal(fixture.hasAuthorizedQuizRef.current, false);
  assert.match(pageSource, /: quizError \? \([\s\S]*?Failed to Load Quiz/);
  fixture.cleanup();
});

test("unauthorized and not-found responses cannot clear the generic error", async () => {
  for (const error of ["Unauthorized", "Quiz not found"]) {
    const fixture = createFixture([
      { ok: false, body: { error } },
      { ok: false, body: { success: true, quiz: authorizedQuiz.quiz } },
      { ok: false, body: { error } },
    ]);
    await fixture.flush();
    await fixture.poll();
    await fixture.loadQuizRef.current?.();
    assert.equal(fixture.state.error, error);
    assert.equal(fixture.state.quiz, null);
    fixture.cleanup();
  }
});

test("authorized rejected state replaces a transient load error with the rejection banner", async () => {
  const fixture = createFixture([
    { ok: false, body: { error: "Temporary server failure" } },
    { ok: true, body: { ...authorizedQuiz, studentQuizStatus: "rejected" } },
  ]);
  await fixture.flush();
  await fixture.poll();
  assert.equal(fixture.state.error, "");
  assert.equal(fixture.state.status, "rejected");
  assert.equal(fixture.state.canEnter, false);
  assert.match(pageSource, /studentQuizStatus === "rejected" \? \([\s\S]*?Late Entry Request Rejected/);
  fixture.cleanup();
});

test("normal successful initial load remains unchanged", async () => {
  const fixture = createFixture([{ ok: true, body: authorizedQuiz }]);
  await fixture.flush();
  assert.equal(fixture.state.error, "");
  assert.equal(fixture.state.loading, false);
  assert.equal(fixture.state.status, "enrolled");
  assert.equal(fixture.state.intervalCount, 1);
  fixture.cleanup();
});
