import { loadUserLifecycleModule } from "./helpers/user-lifecycle-module.ts";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

type ElementNode = { type: string; props: Record<string, unknown> };
type Reply = { ok: boolean; body?: Record<string, unknown> } | Error;

function textOf(value: unknown): string {
  if (Array.isArray(value)) return value.map(textOf).join("");
  if (value && typeof value === "object" && "props" in value) return textOf((value as ElementNode).props.children);
  return value == null || typeof value === "boolean" ? "" : String(value);
}

function nodesOf(value: unknown, predicate: (node: ElementNode) => boolean): ElementNode[] {
  if (Array.isArray(value)) return value.flatMap((child) => nodesOf(child, predicate));
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const node = value as ElementNode;
  return [...(predicate(node) ? [node] : []), ...nodesOf(node.props.children, predicate)];
}

function fixture(relativePath: string, responses: Record<string, Reply[]>) {
  const absolutePath = path.resolve(process.cwd(), relativePath);
  const code = ts.transpileModule(fs.readFileSync(absolutePath, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;
  const state: unknown[] = [];
  const effects: Array<() => void> = [];
  const requests: string[] = [];
  let hookIndex = 0;
  let collectEffects = true;
  let timers = 0;
  const subscriptions = 0;
  const react = {
    createContext: (value: unknown) => ({value}),
    useContext: (context: {value: unknown}) => context.value,
    useState: (initial: unknown) => {
      const index = hookIndex++;
      if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial;
      return [state[index], (next: unknown) => {
        state[index] = typeof next === "function" ? (next as (previous: unknown) => unknown)(state[index]) : next;
      }];
    },
    useRef: (initial: unknown) => { const index=hookIndex++; if(!(index in state)) state[index]={current:initial}; return state[index]; },
    useCallback: (callback: unknown) => { hookIndex++; return callback; },
    useEffect: (callback: () => void) => {
      hookIndex++;
      if (collectEffects) effects.push(callback);
    },
    useTransition: () => { hookIndex++; return [false, (callback: () => void) => callback()]; },
  };
  const lifecycle = loadUserLifecycleModule(react);
  const jsx = (type: string, props: Record<string, unknown>) => ({ type, props });
  const component: { default?: () => ElementNode } = {};
  vm.runInNewContext(code, {
    exports: component,
    require: (name: string) => {
      if (name === "@/components/user-session-lifecycle") return lifecycle;
      if (name === "react") return react;
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (name === "lucide-react") return {};
      if (name === "next/link") return "link";
      if (name === "next/navigation") return { useRouter: () => ({ push() {} }) };
      if (name === "@/components/student/ResultModal") return { __esModule: true, default: "result-modal" };
      if (name === "@/lib/student-gamify") return {
        playBloop() {}, playSuccessFanfare() {}, playErrorBuzz() {},
        isSoundEnabled: () => true, toggleSoundEnabled: () => false,
      };
      if (name === "@/lib/quiz-access-code") return {
        normalizeQuizAccessCode: (value: string) => value,
        QUIZ_ACCESS_CODE_INPUT_MAX_LENGTH: 20,
      };
      if (name === "@/lib/backup-write-gate" || name === "./backup-write-gate") return { withBackupWriteGate: (handler: unknown) => handler, runBackupWriteOrReject: (work: () => Promise<unknown>) => work(), runIncidentalBackupWrite: (work: () => Promise<unknown>) => work() };
      throw new Error(`Unexpected dependency: ${name}`);
    },
    AbortController,
    fetch: async (url: string) => {
      requests.push(url);
      const reply = responses[url]?.shift();
      assert.ok(reply, `Unexpected request to ${url}`);
      if (reply instanceof Error) throw reply;
      return { ok: reply.ok, json: async () => reply.body };
    },
    setInterval: () => { timers++; return timers; },
    console: { error() {} },
    process: { env: {} },
  }, { filename: absolutePath });

  const render = () => { hookIndex = 0; return component.default!(); };
  const settle = async () => { await new Promise(setImmediate); };
  return {
    render,
    mount: async () => {
      render();
      collectEffects = false;
      effects.forEach((effect) => effect());
      await settle();
    },
    refetch: async () => { effects.forEach((effect) => effect()); await settle(); },
    retry: async (index = 0) => {
      const buttons = nodesOf(render(), (node) => node.type === "button" && textOf(node) === "Retry");
      assert.ok(buttons[index], `Retry button ${index} is available`);
      (buttons[index].props.onClick as () => void)();
      await settle();
    },
    requestCount: (url: string) => requests.filter((request) => request === url).length,
    timers: () => timers,
    subscriptions: () => subscriptions,
  };
}

const progression = {
  success: true, totalExp: 850, level: 2, currentLevelExp: 350,
  expToNextLevel: 150, progressPercent: 70, title: "Explorer",
};
const quiz = { id: "enrollment-1", quizStatus: "playing", quiz: { id: 10, title: "Science Quiz", duration: 30 } };
const result = { id: "attempt-1", quiz: { title: "Science Result" }, score: 90, createdAt: "2026-09-01" };
const cases = [
  {
    name: "Dashboard", path: "src/app/dashboard/student/content.tsx", url: "/api/quizzes",
    empty: { success: true, quizzes: [] }, populated: { success: true, quizzes: [quiz] },
    emptyText: "All caught up!", populatedText: "Science Quiz", error: "Could not load your quizzes.",
  },
  {
    name: "My Quizzes", path: "src/app/dashboard/student/quizzes/content.tsx", url: "/api/quizzes",
    empty: { success: true, quizzes: [] }, populated: { success: true, quizzes: [quiz] },
    emptyText: "No enrolled quizzes found", populatedText: "Science Quiz", error: "Could not load My Quizzes.",
  },
  {
    name: "Results", path: "src/app/dashboard/student/results/content.tsx", url: "/api/dashboard/student/results",
    empty: { success: true, results: [] }, populated: { success: true, results: [result] },
    emptyText: "No quiz history found.", populatedText: "Science Result", error: "Could not load your results.",
  },
];

function repliesFor(url: string, replies: Reply[]) {
  return url === "/api/quizzes" ? { [url]: replies, "/api/student/progression": [{ ok: true, body: progression }] }
    : { [url]: replies };
}

for (const entry of cases) {
  for (const failure of [{ ok: false } as Reply, new Error("network failure")]) {
    test(`${entry.name} ${failure instanceof Error ? "network" : "HTTP 500"} failure shows error and Retry recovers empty state`, async () => {
      const setup = fixture(entry.path, repliesFor(entry.url, [failure, { ok: true, body: entry.empty }]));
      await setup.mount();
      assert.match(textOf(setup.render()), new RegExp(entry.error.replace(".", "\\.")));
      assert.doesNotMatch(textOf(setup.render()), new RegExp(entry.emptyText));
      assert.ok(nodesOf(setup.render(), (node) => node.props.role === "alert").length > 0);
      await setup.retry();
      assert.match(textOf(setup.render()), new RegExp(entry.emptyText));
      assert.doesNotMatch(textOf(setup.render()), new RegExp(entry.error.replace(".", "\\.")));
      assert.equal(setup.requestCount(entry.url), 2);
      assert.equal(setup.timers(), 0);
      assert.equal(setup.subscriptions(), 0);
    });
  }

  test(`${entry.name} persistent failure keeps error and repeated Retry recovers populated data once`, async () => {
    const setup = fixture(entry.path, repliesFor(entry.url, [
      { ok: false }, { ok: false }, { ok: true, body: entry.populated },
    ]));
    await setup.mount();
    await setup.retry();
    assert.match(textOf(setup.render()), new RegExp(entry.error.replace(".", "\\.")));
    await setup.retry();
    assert.match(textOf(setup.render()), new RegExp(entry.populatedText));
    assert.equal(setup.requestCount(entry.url), 3);
    assert.equal(setup.timers(), 0);
    assert.equal(setup.subscriptions(), 0);
  });

  test(`${entry.name} successful empty response is not an error`, async () => {
    const setup = fixture(entry.path, repliesFor(entry.url, [{ ok: true, body: entry.empty }]));
    await setup.mount();
    assert.match(textOf(setup.render()), new RegExp(entry.emptyText));
    assert.doesNotMatch(textOf(setup.render()), new RegExp(entry.error.replace(".", "\\.")));
  });

  test(`${entry.name} retains loaded data during a failed refetch`, async () => {
    const responses = repliesFor(entry.url, [{ ok: true, body: entry.populated }, { ok: false }]);
    if (entry.name === "Dashboard") responses["/api/student/progression"]!.push({ ok: true, body: progression });
    const setup = fixture(entry.path, responses);
    await setup.mount();
    await setup.refetch();
    assert.match(textOf(setup.render()), new RegExp(entry.populatedText));
    assert.match(textOf(setup.render()), new RegExp(entry.error.replace(".", "\\.")));
    assert.doesNotMatch(textOf(setup.render()), new RegExp(entry.emptyText));
  });
}

test("Dashboard progression failure never displays fabricated Level 1 or zero EXP and Retry recovers", async () => {
  const setup = fixture(cases[0].path, {
    "/api/quizzes": [{ ok: true, body: cases[0].empty }],
    "/api/student/progression": [{ ok: false }, { ok: true, body: progression }],
  });
  await setup.mount();
  assert.match(textOf(setup.render()), /Progression unavailable/);
  assert.match(textOf(setup.render()), /Could not load your progression/);
  assert.doesNotMatch(textOf(setup.render()), /Level 1|0 Total EXP/);
  await setup.retry(0);
  assert.match(textOf(setup.render()), /Level 2/);
  assert.match(textOf(setup.render()), /850 Total EXP/);
  assert.equal(setup.requestCount("/api/student/progression"), 2);
  assert.equal(setup.requestCount("/api/quizzes"), 1);
});

test("Dashboard progression network failure preserves previously loaded values", async () => {
  const setup = fixture(cases[0].path, {
    "/api/quizzes": [{ ok: true, body: cases[0].empty }, { ok: true, body: cases[0].empty }],
    "/api/student/progression": [{ ok: true, body: progression }, new Error("offline")],
  });
  await setup.mount();
  await setup.refetch();
  assert.match(textOf(setup.render()), /Level 2/);
  assert.match(textOf(setup.render()), /Could not load your progression/);
  assert.equal(setup.timers(), 0);
  assert.equal(setup.subscriptions(), 0);
});
