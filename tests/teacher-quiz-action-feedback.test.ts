import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

type ElementNode = { type: string; props: Record<string, unknown> };
type Quiz = { id: number; title: string; quizStatus: string; quizMode: string; duration: number; totalQuestions: number; allowRetake: boolean };

function textOf(value: unknown): string {
  if (Array.isArray(value)) return value.map(textOf).join("");
  if (value && typeof value === "object" && "props" in value) return textOf((value as ElementNode).props.children);
  return value === null || value === undefined || typeof value === "boolean" ? "" : String(value);
}

function nodesOf(value: unknown, predicate: (node: ElementNode) => boolean): ElementNode[] {
  if (Array.isArray(value)) return value.flatMap((child) => nodesOf(child, predicate));
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const node = value as ElementNode;
  return [...(predicate(node) ? [node] : []), ...nodesOf(node.props.children, predicate)];
}

function fixture(initialStatus = "active") {
  const componentPath = path.resolve(process.cwd(), "src/app/dashboard/teacher/quizzes/content.tsx");
  const compiled = ts.transpileModule(fs.readFileSync(componentPath, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const server: { quiz: Quiz; retakes: Array<{ studentQuizId: number; studentName: string; quizTitle: string }> } = {
    quiz: { id: 46, title: "Action QA Quiz", quizStatus: initialStatus, quizMode: "proctored", duration: 30, totalQuestions: 1, allowRetake: false },
    retakes: [{ studentQuizId: 7, studentName: "QA Student", quizTitle: "Action QA Quiz" }],
  };
  const failures = new Map<string, { status: number; error: string }>();
  const requests: string[] = [];
  const states: unknown[] = [];
  const effects: Array<() => void> = [];
  let stateIndex = 0;
  let collectEffects = true;
  const react = {
    useState: (initial: unknown) => {
      const index = stateIndex++;
      if (!(index in states)) states[index] = initial;
      return [states[index], (next: unknown) => { states[index] = typeof next === "function" ? (next as (previous: unknown) => unknown)(states[index]) : next; }];
    },
    useRef: () => ({ current: null }),
    useEffect: (callback: () => void) => { if (collectEffects) effects.push(callback); },
  };
  const jsx = (type: string, props: Record<string, unknown>) => ({ type, props });
  const component: { default?: (props: Record<string, unknown>) => ElementNode } = {};
  vm.runInNewContext(compiled, {
    exports: component,
    require: (name: string) => {
      if (name === "react") return react;
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (name === "react-dom") return { createPortal: (node: ElementNode) => node };
      if (name === "next/navigation") return { useRouter: () => ({ push() {} }) };
      if (name === "next/link") return "link";
      if (name === "@/lib/subscription-rules") return { FREE_STUDENT_LIMIT_PER_QUIZ: 5, PRO_STUDENT_LIMIT_PER_QUIZ: 100 };
      if (name.startsWith("@/components/teacher/")) return { __esModule: true, default: name };
      if (name === "lucide-react") return {};
      throw new Error(`Unexpected dependency: ${name}`);
    },
    fetch: async (url: string, options?: { method?: string; body?: string }) => {
      const method = options?.method ?? "GET";
      const key = `${method} ${url}`;
      requests.push(key);
      if (url === "/api/billing/status") return { ok: true, json: async () => ({ isSubscribed: false, manualQuizCount: 0, manualQuizLimit: 5 }) };
      if (key === "GET /api/quizzes") return { ok: true, json: async () => ({ success: true, quizzes: [{ ...server.quiz }], pendingRetakes: [...server.retakes], pendingApprovals: [] }) };
      const failure = failures.get(key);
      if (failure) return { ok: false, status: failure.status, json: async () => ({ error: failure.error }) };
      if (key === "POST /api/quizzes/46/start") {
        server.quiz.quizStatus = "in_progress";
        return { ok: true, json: async () => ({ success: true }) };
      }
      if (key === "PUT /api/quizzes/46") {
        Object.assign(server.quiz, JSON.parse(options!.body!));
        return { ok: true, json: async () => ({ success: true, quiz: { ...server.quiz } }) };
      }
      if (key === "POST /api/quizzes/retake/approve") {
        server.retakes = [];
        return { ok: true, json: async () => ({ success: true }) };
      }
      throw new Error(`Unexpected request: ${key}`);
    },
    window: { location: { search: "" } },
    document: { body: {} },
    URLSearchParams,
    confirm: () => true,
    console: { error() {} },
  }, { filename: componentPath });
  const render = () => { stateIndex = 0; collectEffects = false; return component.default!({ isSubscribed: false }); };
  stateIndex = 0;
  component.default!({ isSubscribed: false });
  const button = (label: string) => {
    const found = nodesOf(render(), (node) => node.type === "button" && textOf(node) === label)[0];
    assert.ok(found, `${label} button exists`);
    return found;
  };
  const click = async (label: string) => { await (button(label).props.onClick as () => Promise<void>)(); await new Promise(setImmediate); };
  const error = () => nodesOf(render(), (node) => node.props.role === "alert").map(textOf).join(" ");
  return { server, failures, requests, render, button, click, error, mount: async () => { effects.forEach((effect) => effect()); await new Promise(setImmediate); } };
}

test("failed Start explains the error without showing a started quiz; success refetches", async () => {
  const setup = fixture();
  await setup.mount();
  setup.failures.set("POST /api/quizzes/46/start", { status: 409, error: "Add at least one question before starting the quiz" });
  await setup.click("Start");
  assert.equal(setup.server.quiz.quizStatus, "active");
  assert.ok(setup.button("Start"));
  assert.match(setup.error(), /Add at least one question/);
  assert.match(String(nodesOf(setup.render(), (node) => node.props.role === "alert")[0].props.className), /fixed bottom-4/);
  setup.failures.clear();
  await setup.click("Start");
  assert.equal(setup.server.quiz.quizStatus, "in_progress");
  assert.doesNotMatch(textOf(setup.render()), /Add at least one question/);
  assert.equal(setup.requests.filter((request) => request === "GET /api/quizzes").length, 2);
});

test("failed status and End actions retain the modal's authoritative status; successful actions update it", async () => {
  const statusSetup = fixture();
  await statusSetup.mount();
  await statusSetup.click("Manage");
  statusSetup.failures.set("PUT /api/quizzes/46", { status: 409, error: "Status transition rejected" });
  await statusSetup.click("Set to Draft");
  assert.equal(statusSetup.server.quiz.quizStatus, "active");
  assert.ok(statusSetup.button("Set to Draft"));
  assert.match(statusSetup.error(), /Status transition rejected/);
  statusSetup.failures.clear();
  await statusSetup.click("Set to Draft");
  assert.equal(statusSetup.server.quiz.quizStatus, "draft");
  assert.ok(statusSetup.button("Make Active"));

  const endSetup = fixture("in_progress");
  await endSetup.mount();
  await endSetup.click("Manage");
  endSetup.failures.set("PUT /api/quizzes/46", { status: 500, error: "Could not end quiz" });
  await endSetup.click("End Quiz");
  assert.equal(endSetup.server.quiz.quizStatus, "in_progress");
  assert.match(endSetup.error(), /Could not end quiz/);
  endSetup.failures.clear();
  await endSetup.click("End Quiz");
  assert.equal(endSetup.server.quiz.quizStatus, "ended");
  assert.ok(endSetup.button("Ended"));
});

for (const label of ["Reject", "Accept Retake"]) {
  test(`failed ${label} keeps the retake request visible; successful retry reconciles it`, async () => {
    const setup = fixture();
    await setup.mount();
    setup.failures.set("POST /api/quizzes/retake/approve", { status: 409, error: "Retake no longer pending" });
    await setup.click(label);
    assert.equal(setup.server.retakes.length, 1);
    assert.match(textOf(setup.render()), /Retake Requests \(1\)/);
    assert.match(setup.error(), /Retake no longer pending/);
    setup.failures.clear();
    await setup.click(label);
    assert.equal(setup.server.retakes.length, 0);
    assert.doesNotMatch(textOf(setup.render()), /Retake Requests \(1\)/);
  });
}

test("failed retake setting change reports an error and leaves the controlled value unchanged", async () => {
  const setup = fixture();
  await setup.mount();
  await setup.click("Manage");
  setup.failures.set("PUT /api/quizzes/46", { status: 500, error: "Retake setting failed" });
  const checkbox = nodesOf(setup.render(), (node) => node.type === "input" && node.props.type === "checkbox")[0];
  assert.equal(checkbox.props.checked, false);
  await (checkbox.props.onChange as (event: { target: { checked: boolean } }) => Promise<void>)({ target: { checked: true } });
  assert.equal(setup.server.quiz.allowRetake, false);
  assert.match(setup.error(), /Retake setting failed/);
});

function monitorDecisionFixture(handlerName: "handleApprove" | "handleRetakeApprove") {
  const monitorPath = path.resolve(process.cwd(), "src/app/dashboard/teacher/monitor/content.tsx");
  const source = fs.readFileSync(monitorPath, "utf8");
  const sourceFile = ts.createSourceFile(monitorPath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let declaration: ts.VariableDeclaration | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(sourceFile) === handlerName) declaration = node;
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  assert.ok(declaration);
  const code = ts.transpileModule(`const ${declaration.getText(sourceFile)}; exports.handler = ${handlerName};`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const state = { pending: [{ studentQuizId: 7 }], error: null as string | null, failed: true };
  const exports: { handler?: (id: number, action: "accept" | "reject") => Promise<void> } = {};
  vm.runInNewContext(code, {
    exports,
    fetch: async () => ({ ok: !state.failed, json: async () => ({ error: "Decision rejected" }) }),
    setDecisionError: (error: string | null) => { state.error = error; },
    setPendingApprovals: (update: (pending: typeof state.pending) => typeof state.pending) => { state.pending = update(state.pending); },
    setPendingRetakes: (update: (pending: typeof state.pending) => typeof state.pending) => { state.pending = update(state.pending); },
  });
  assert.ok(exports.handler);
  assert.match(source, /\{decisionError && <div role="alert"/);
  return { state, handler: exports.handler };
}

for (const handlerName of ["handleApprove", "handleRetakeApprove"] as const) {
  test(`Live Monitor ${handlerName} keeps failed decisions visible and removes them after success`, async () => {
    const setup = monitorDecisionFixture(handlerName);
    await setup.handler(7, "reject");
    assert.equal(setup.state.pending.length, 1);
    assert.equal(setup.state.error, "Decision rejected");
    setup.state.failed = false;
    await setup.handler(7, "reject");
    assert.equal(setup.state.pending.length, 0);
    assert.equal(setup.state.error, null);
  });
}
