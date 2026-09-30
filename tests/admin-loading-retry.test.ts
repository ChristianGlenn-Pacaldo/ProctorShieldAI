import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { createAiLogsCsv } from "../src/app/dashboard/admin/logs/csv.ts";

type ElementNode = { type: string; props: Record<string, unknown> };
type Reply = { ok: boolean; status?: number; body?: Record<string, unknown> } | Error;

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

function fixture(relativePath: string, replies: Reply[]) {
  const absolutePath = path.resolve(process.cwd(), relativePath);
  const code = ts.transpileModule(fs.readFileSync(absolutePath, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;
  const states: unknown[] = [];
  let stateIndex = 0;
  let effectStarted = false;
  let subscriptions = 0;
  let timers = 0;
  let requests = 0;
  let activity: ((data: { type: string }) => void) | undefined;
  const react = {
    useState: (initial: unknown) => {
      const index = stateIndex++;
      if (!(index in states)) states[index] = initial;
      return [states[index], (next: unknown) => {
        states[index] = typeof next === "function" ? (next as (previous: unknown) => unknown)(states[index]) : next;
      }];
    },
    useEffect: (callback: () => void) => {
      if (!effectStarted) {
        effectStarted = true;
        callback();
      }
    },
  };
  const jsx = (type: string, props: Record<string, unknown>) => ({ type, props });
  const component: { default?: () => ElementNode } = {};
  vm.runInNewContext(code, {
    exports: component,
    require: (name: string) => {
      if (name === "react") return react;
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (name === "lucide-react") return {};
      if (name === "./csv") return { createAiLogsCsv };
      if (name === "next/link") return "link";
      if (name === "pusher-js") return { __esModule: true, default: class {
        subscribe() {
          subscriptions++;
          return { bind: (_event: string, callback: (data: { type: string }) => void) => { activity = callback; } };
        }
        unsubscribe() {}
        disconnect() {}
      } };
      if (name === "@/lib/backup-write-gate" || name === "./backup-write-gate") return { withBackupWriteGate: (handler: unknown) => handler, runBackupWriteOrReject: (work: () => Promise<unknown>) => work(), runIncidentalBackupWrite: (work: () => Promise<unknown>) => work() };
      throw new Error(`Unexpected dependency: ${name}`);
    },
    fetch: async () => {
      requests++;
      const reply = replies.shift();
      assert.ok(reply, "unexpected request");
      if (reply instanceof Error) throw reply;
      return { ok: reply.ok, status: reply.status ?? 200, json: async () => reply.body };
    },
    process: { env: {} },
    console: { error() {} },
    setInterval: () => { timers++; return 1; },
    clearInterval() {},
  }, { filename: absolutePath });
  const render = () => { stateIndex = 0; return component.default!(); };
  return {
    render,
    ready: async () => { await new Promise(setImmediate); },
    retry: async () => {
      const button = nodesOf(render(), (node) => node.type === "button" && textOf(node) === "Retry")[0];
      assert.ok(button, "Retry is available");
      await (button.props.onClick as () => Promise<void>)();
    },
    emit: (type: string) => { assert.ok(activity); activity({ type }); },
    requests: () => requests,
    subscriptions: () => subscriptions,
    timers: () => timers,
    states,
  };
}

const dashboardPath = "src/app/dashboard/admin/content.tsx";
const usersPath = "src/app/dashboard/admin/users/content.tsx";
const quizzesPath = "src/app/dashboard/admin/quizzes/content.tsx";
const logsPath = "src/app/dashboard/admin/logs/content.tsx";
const dashboardBody = (count: number) => ({
  stats: { totalUsers: count, totalQuizzes: 0, totalViolations: 0, aiVerdictsToday: 0 },
  platformBars: [], activityBars: [], activities: [], users: [],
});
const user = { id: "u1", name: "Test Teacher", email: "teacher@example.invalid", role: "Teacher", status: "Active", joined: "Today" };
const quiz = { id: 1, title: "Test Quiz", teacher: { fullName: "Test Teacher" }, createdAt: "2026-09-01T00:00:00.000Z", quizStatus: "draft" };
const log = { id: "l1", timestamp: "Today", event: "Test Event", severity: "Low", severityClass: "", rowBg: "", student: "Student", quiz: "Test Quiz", confidence: "90%" };
const cases = [
  { name: "Dashboard", path: dashboardPath, empty: dashboardBody(0), populated: dashboardBody(1), visible: "Active Sessions", error: "Could not load Admin Dashboard data" },
  { name: "Users", path: usersPath, empty: { users: [] }, populated: { users: [user] }, visible: "Test Teacher", error: "Could not load Admin Users" },
  { name: "All Quizzes", path: quizzesPath, empty: { quizzes: [] }, populated: { quizzes: [quiz] }, visible: "Test Quiz", error: "Could not load Admin Quizzes" },
  { name: "AI Logs", path: logsPath, empty: { success: true, logs: [], total: 0, page: 1, pageSize: 25 }, populated: { success: true, logs: [log], total: 1, page: 1, pageSize: 25 }, visible: "Test Event", error: "Could not load Admin AI Logs" },
];

for (const entry of cases) {
  test(`${entry.name} distinguishes HTTP failure, empty success, and Retry recovery`, async () => {
    const setup = fixture(entry.path, [
      { ok: false, status: 500 },
      { ok: true, body: entry.empty },
    ]);
    setup.render();
    await setup.ready();
    const failed = setup.render();
    assert.equal(nodesOf(failed, (node) => node.props.role === "alert").length, 1);
    assert.match(textOf(failed), new RegExp(entry.error));
    await setup.retry();
    const recovered = setup.render();
    assert.equal(nodesOf(recovered, (node) => node.props.role === "alert").length, 0);
    assert.equal(setup.requests(), 2);
    assert.equal(setup.subscriptions(), entry.name === "AI Logs" ? 0 : 1);
    assert.equal(setup.timers(), entry.name === "Dashboard" ? 1 : 0);
    if (entry.name === "Users") assert.match(textOf(recovered), /No users found/);
    if (entry.name === "All Quizzes") assert.match(textOf(recovered), /No quizzes found/);
    if (entry.name === "AI Logs") assert.match(textOf(recovered), /No AI violation events recorded yet/);
  });

  test(`${entry.name} recovers from network failure to populated data without duplicate subscriptions`, async () => {
    const setup = fixture(entry.path, [new Error("network down"), { ok: true, body: entry.populated }]);
    setup.render();
    await setup.ready();
    assert.match(textOf(setup.render()), new RegExp(entry.error));
    await setup.retry();
    const recovered = setup.render();
    assert.doesNotMatch(textOf(recovered), new RegExp(entry.error));
    assert.match(textOf(recovered), new RegExp(entry.visible));
    assert.equal(setup.subscriptions(), entry.name === "AI Logs" ? 0 : 1);
    assert.equal(setup.timers(), entry.name === "Dashboard" ? 1 : 0);
  });
}

test("dashboard preserves valid statistics when a background refresh fails", async () => {
  const setup = fixture(dashboardPath, [{ ok: true, body: dashboardBody(7) }, { ok: false, status: 500 }]);
  setup.render();
  await setup.ready();
  setup.emit("login");
  await setup.ready();
  assert.equal((setup.states[0] as { totalUsers: number }).totalUsers, 7);
  assert.match(textOf(setup.render()), /Could not load Admin Dashboard data/);
  assert.equal(setup.subscriptions(), 1);
  assert.equal(setup.timers(), 1);
});

test("Users and All Quizzes retain server rows after a transient realtime refresh failure", async () => {
  for (const [pathName, initial, eventType, visible] of [
    [usersPath, { users: [user] }, "register", "Test Teacher"],
    [quizzesPath, { quizzes: [quiz] }, "quiz-deleted", "Test Quiz"],
  ] as const) {
    const setup = fixture(pathName, [{ ok: true, body: initial }, { ok: false, status: 500 }]);
    setup.render();
    await setup.ready();
    setup.emit(eventType);
    await setup.ready();
    assert.match(textOf(setup.render()), new RegExp(visible));
    assert.equal(nodesOf(setup.render(), (node) => node.props.role === "alert").length, 1);
    assert.equal(setup.subscriptions(), 1);
    assert.equal(setup.requests(), 2);
  }
});
