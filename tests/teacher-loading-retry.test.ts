import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

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
  const hooks: unknown[] = [];
  const effects: Array<() => void> = [];
  const events = new Map<string, (data: Record<string, unknown>) => void>();
  const intervals: Array<() => void> = [];
  let hookIndex = 0;
  let collectingEffects = true;
  let subscriptions = 0;
  let requests = 0;
  const react = {
    useState: (initial: unknown) => {
      const index = hookIndex++;
      if (!(index in hooks)) hooks[index] = initial;
      return [hooks[index], (next: unknown) => {
        hooks[index] = typeof next === "function" ? (next as (previous: unknown) => unknown)(hooks[index]) : next;
      }];
    },
    useRef: (initial: unknown) => {
      const index = hookIndex++;
      if (!(index in hooks)) hooks[index] = { current: initial };
      return hooks[index];
    },
    useCallback: (callback: unknown) => {
      hookIndex++;
      return callback;
    },
    useEffect: (callback: () => void) => {
      hookIndex++;
      if (collectingEffects) effects.push(callback);
    },
  };
  const jsx = (type: string, props: Record<string, unknown>) => ({ type, props });
  const component: { default?: (props: Record<string, unknown>) => ElementNode } = {};
  const location = { href: "http://localhost/dashboard/teacher", search: "" };
  const timer = (callback: () => void) => { intervals.push(callback); return intervals.length; };
  vm.runInNewContext(code, {
    exports: component,
    require: (name: string) => {
      if (name === "react") return react;
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (name === "react-dom") return { createPortal: jsx };
      if (name === "lucide-react") return {};
      if (name === "next/link") return "link";
      if (name === "next/navigation") return { useRouter: () => ({ push() {} }) };
      if (name === "@/lib/subscription-rules") return {
        FREE_MANUAL_QUIZ_LIMIT: 5, FREE_STUDENT_LIMIT_PER_QUIZ: 5,
        PRO_MONTHLY_PRICE_PHP: 299, PRO_STUDENT_LIMIT_PER_QUIZ: 50,
      };
      if (name.startsWith("@/components/teacher/")) return { __esModule: true, default: name };
      if (name === "pusher-js") return { __esModule: true, default: class {
        subscribe() {
          subscriptions++;
          return { bind: (event: string, callback: (data: Record<string, unknown>) => void) => { events.set(event, callback); } };
        }
        unsubscribe() {}
        disconnect() {}
      } };
      throw new Error(`Unexpected dependency: ${name}`);
    },
    fetch: async (url: string) => {
      if (url === "/api/billing/status") return { ok: true, json: async () => ({ isSubscribed: true, manualQuizCount: 0, manualQuizLimit: 5 }) };
      requests++;
      const reply = replies.shift();
      assert.ok(reply, `unexpected request to ${url}`);
      if (reply instanceof Error) throw reply;
      return { ok: reply.ok, status: reply.status ?? 200, json: async () => reply.body };
    },
    window: { location, history: { replaceState() {} }, setInterval: timer, clearInterval() {}, setTimeout: timer },
    document: { body: { style: {} }, addEventListener() {}, removeEventListener() {} },
    process: { env: {} },
    console: { error() {} },
    URL,
    URLSearchParams,
  }, { filename: absolutePath });
  const render = () => {
    hookIndex = 0;
    return component.default!({ teacherId: "teacher-1", isSubscribed: true });
  };
  return {
    render,
    mount: async () => {
      render();
      collectingEffects = false;
      effects.forEach((effect) => effect());
      await new Promise(setImmediate);
    },
    ready: async () => { await new Promise(setImmediate); },
    retry: async () => {
      const button = nodesOf(render(), (node) => node.type === "button" && textOf(node) === "Retry")[0];
      assert.ok(button, "Retry is available");
      (button.props.onClick as () => void)();
      await new Promise(setImmediate);
    },
    refetch: async () => {
      const marker = relativePath.includes("/billing/") ? "loadBilling"
        : relativePath.includes("/reports/") ? "fetchData"
        : relativePath.includes("/evidence/") ? "fetchEvidence"
        : relativePath.includes("/quizzes/") ? "fetchQuizzes"
        : "fetchDashboardData";
      const primaryEffect = effects.find((effect) => effect.toString().includes(marker));
      assert.ok(primaryEffect, "primary fetch effect exists");
      primaryEffect();
      await new Promise(setImmediate);
    },
    emit: async (event: string) => {
      const callback = events.get(event);
      assert.ok(callback, `${event} subscription exists`);
      callback({ studentName: "Student" });
      await new Promise(setImmediate);
    },
    poll: async () => {
      assert.equal(intervals.length, 1);
      intervals[0]();
      await new Promise(setImmediate);
    },
    requests: () => requests,
    subscriptions: () => subscriptions,
    intervals: () => intervals.length,
  };
}

const dashboardBody = (count: number) => ({
  stats: { totalQuizzes: count, studentsMonitored: 0, totalViolations: 0, flaggedStudents: 0 },
  recentVerdicts: [], violationsBreakdown: [],
});
const quiz = { id: 1, title: "Regression Quiz", mode: "proctored", subject: "Science", quizStatus: "draft", questions: [], studentQuizzes: [] };
const evidence = { id: "e1", name: "Regression Student", quizTitle: "Regression Quiz", event: "Tab switch", violationType: "tab_switch", timestamp: "Today", bg: "", btnClass: "", screenshotPath: null, evidenceType: null, durationSeconds: null };
const report = { label: "Clean", value: 3, pct: 100, color: "bg-green-500" };
const cases = [
  { name: "Dashboard", path: "src/app/dashboard/teacher/content.tsx", empty: dashboardBody(0), populated: dashboardBody(7), visible: "Total Quizzes", emptyText: "Total Quizzes", error: "Could not load the Teacher Dashboard" },
  { name: "My Quizzes", path: "src/app/dashboard/teacher/quizzes/content.tsx", empty: { quizzes: [], pendingRetakes: [], pendingApprovals: [] }, populated: { quizzes: [quiz], pendingRetakes: [], pendingApprovals: [] }, visible: "Regression Quiz", emptyText: "No quizzes found", error: "Could not load My Quizzes" },
  { name: "Evidence", path: "src/app/dashboard/teacher/evidence/content.tsx", empty: { success: true, evidence: [], total: 0, page: 1, pageSize: 25 }, populated: { success: true, evidence: [evidence], total: 1, page: 1, pageSize: 25 }, visible: "Regression Student", emptyText: "No proctoring violations recorded", error: "Could not load Evidence Logs" },
  { name: "Reports", path: "src/app/dashboard/teacher/reports/content.tsx", empty: { success: true, data: [] }, populated: { success: true, data: [report] }, visible: "Clean", emptyText: "No quiz data available yet", error: "Could not load Teacher Reports" },
  { name: "Billing", path: "src/app/dashboard/teacher/billing/content.tsx", empty: { isSubscribed: false, subscription: null, payments: [], paymentMode: "test" }, populated: { isSubscribed: true, subscription: { planName: "Premium Tier" }, payments: [], paymentMode: "test" }, visible: "Premium Tier", emptyText: "Free Tier", error: "Could not load Billing" },
];

for (const entry of cases) {
  for (const failure of [{ ok: false, status: 500 } as Reply, new Error("network failure")]) {
    test(`${entry.name} ${failure instanceof Error ? "network" : "HTTP 500"} failure is not empty and Retry recovers`, async () => {
      const setup = fixture(entry.path, [failure, { ok: true, body: entry.empty }]);
      await setup.mount();
      const failed = setup.render();
      assert.match(textOf(failed), new RegExp(entry.error));
      assert.equal(nodesOf(failed, (node) => node.props.role === "alert").length, 1);
      assert.doesNotMatch(textOf(failed), new RegExp(entry.emptyText));
      await setup.retry();
      const empty = setup.render();
      assert.doesNotMatch(textOf(empty), new RegExp(entry.error));
      assert.match(textOf(empty), new RegExp(entry.emptyText));
      assert.equal(setup.requests(), 2);
      assert.equal(setup.subscriptions(), entry.name === "Dashboard" ? 1 : 0);
      assert.equal(setup.intervals(), entry.name === "Evidence" ? 1 : 0);
    });
  }

  test(`${entry.name} Retry recovers populated server data`, async () => {
    const setup = fixture(entry.path, [{ ok: false, status: 500 }, { ok: true, body: entry.populated }]);
    await setup.mount();
    await setup.retry();
    assert.match(textOf(setup.render()), new RegExp(entry.visible));
    assert.doesNotMatch(textOf(setup.render()), new RegExp(entry.error));
    assert.equal(setup.requests(), 2);
    assert.equal(setup.subscriptions(), entry.name === "Dashboard" ? 1 : 0);
    assert.equal(setup.intervals(), entry.name === "Evidence" ? 1 : 0);
  });

  test(`${entry.name} repeated Retry does not add subscriptions, timers, or duplicate rows`, async () => {
    const setup = fixture(entry.path, [
      { ok: false, status: 500 },
      { ok: false, status: 500 },
      { ok: true, body: entry.populated },
    ]);
    await setup.mount();
    await setup.retry();
    assert.match(textOf(setup.render()), new RegExp(entry.error));
    await setup.retry();
    assert.equal(setup.requests(), 3);
    assert.equal(setup.subscriptions(), entry.name === "Dashboard" ? 1 : 0);
    assert.equal(setup.intervals(), entry.name === "Evidence" ? 1 : 0);
    if (entry.name === "Evidence") {
      const rows = nodesOf(setup.render(), (node) => typeof node.props.className === "string"
        && node.props.className.includes("justify-between px-5 py-4 cursor-pointer"));
      assert.equal(rows.length, 1);
    } else if (entry.name === "My Quizzes" || entry.name === "Reports") {
      const matches = nodesOf(setup.render(), (node) => node.props.children === entry.visible);
      assert.equal(matches.length, 1);
    }
  });
}

test("Dashboard retains valid statistics after realtime refresh failure without resubscribing", async () => {
  const setup = fixture(cases[0].path, [{ ok: true, body: dashboardBody(7) }, { ok: false, status: 500 }, { ok: true, body: dashboardBody(8) }]);
  await setup.mount();
  await setup.emit("student-submitted");
  assert.match(textOf(setup.render()), /Could not load the Teacher Dashboard/);
  assert.ok(nodesOf(setup.render(), (node) => node.type === "div" && textOf(node) === "7").length > 0);
  await setup.retry();
  assert.ok(nodesOf(setup.render(), (node) => node.type === "div" && textOf(node) === "8").length > 0);
  assert.equal(setup.subscriptions(), 1);
});

test("Evidence preserves loaded rows across a failed poll and Retry does not add intervals", async () => {
  const setup = fixture(cases[2].path, [{ ok: true, body: cases[2].populated }, { ok: false, status: 500 }, { ok: true, body: cases[2].populated }]);
  await setup.mount();
  await setup.poll();
  assert.match(textOf(setup.render()), /Regression Student/);
  assert.match(textOf(setup.render()), /Could not load Evidence Logs/);
  await setup.retry();
  assert.doesNotMatch(textOf(setup.render()), /Could not load Evidence Logs/);
  assert.equal(setup.intervals(), 1);
});

for (const entry of [cases[1], cases[3], cases[4]]) {
  test(`${entry.name} retains previously loaded data on a transient failure`, async () => {
    const setup = fixture(entry.path, [{ ok: true, body: entry.populated }, { ok: false, status: 500 }, { ok: true, body: entry.populated }]);
    await setup.mount();
    await setup.refetch();
    assert.match(textOf(setup.render()), new RegExp(entry.visible));
    assert.match(textOf(setup.render()), new RegExp(entry.error));
    await setup.retry();
    assert.doesNotMatch(textOf(setup.render()), new RegExp(entry.error));
  });
}
