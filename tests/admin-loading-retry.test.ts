import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { createAiLogsCsv } from "../src/app/dashboard/admin/logs/csv.ts";

type ElementNode = { type: string; props: Record<string, unknown> };
type Reply = { ok: boolean; status?: number; body?: Record<string, unknown> | Promise<Record<string, unknown>> } | Error;

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

function fixture(relativePath: string, replies: Array<Reply | Promise<Reply>>) {
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
  const refs: Array<{ current: unknown }> = [];
  let refIndex = 0;
  let effectStarted = false;
  let cleanup: (() => void) | undefined;
  let startEffect: (() => (() => void) | void) | undefined;
  let subscriptions = 0;
  let timers = 0;
  let clearedTimers = 0, disconnected = 0, unbound = 0, unsubscribed = 0, bodyReads = 0;
  let writes = 0;
  const signals: AbortSignal[] = [];
  let poll: (() => void) | undefined;
  let requests = 0;
  let activity: ((data: { type: string }) => void) | undefined;
  const react = {
    useState: (initial: unknown) => {
      const index = stateIndex++;
      if (!(index in states)) states[index] = initial;
      return [states[index], (next: unknown) => {
        writes++;
        states[index] = typeof next === "function" ? (next as (previous: unknown) => unknown)(states[index]) : next;
      }];
    },
    useRef: (initial: unknown) => {
      const index = refIndex++;
      if (!(index in refs)) refs[index] = { current: initial };
      return refs[index];
    },
    useEffect: (callback: () => (() => void) | void) => {
      if (!effectStarted) {
        effectStarted = true;
        startEffect = callback;
        cleanup = callback() || undefined;
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
          return { bind: (_event: string, callback: (data: { type: string }) => void) => { activity = callback; }, unbind_all() { unbound++; } };
        }
        unsubscribe() { unsubscribed++; }
        disconnect() { disconnected++; }
      } };
      if (name === "@/lib/backup-write-gate" || name === "./backup-write-gate") return { withBackupWriteGate: (handler: unknown) => handler, runBackupWriteOrReject: (work: () => Promise<unknown>) => work(), runIncidentalBackupWrite: (work: () => Promise<unknown>) => work() };
      throw new Error(`Unexpected dependency: ${name}`);
    },
    AbortController,
    fetch: async (_url: string, options?: { signal?: AbortSignal }) => {
      requests++;
      if (options?.signal) signals.push(options.signal);
      // Deliberately allow a mocked provider to ignore abort, to test the guards too.
      const reply = await replies.shift();
      assert.ok(reply, "unexpected request");
      if (reply instanceof Error) throw reply;
      return { ok: reply.ok, status: reply.status ?? 200, json: async () => { bodyReads++; return reply.body; } };
    },
    process: { env: {} },
    console: { error() {} },
    setInterval: (callback: () => void) => { timers++; poll = callback; return 1; },
    clearInterval() { clearedTimers++; },
  }, { filename: absolutePath });
  const render = () => { stateIndex = 0; refIndex = 0; return component.default!(); };
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
    tickPoll: () => poll?.(),
    unmount: () => cleanup?.(),
    restartEffect: () => { cleanup?.(); cleanup = startEffect?.() || undefined; },
    captureActivity: () => activity!,
    resources: () => ({ clearedTimers, disconnected, unbound, unsubscribed }),
    bodyReads: () => bodyReads,
    signals,
    writes: () => writes,
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
  assert.match(textOf(setup.render()), /Previously loaded data is stale/);
  assert.match(textOf(setup.render()), /Last successful refresh/);
  assert.doesNotMatch(textOf(setup.render()), /LIVE|REAL-TIME|Violations \(Live\)/);
  assert.equal(setup.subscriptions(), 1);
  assert.equal(setup.timers(), 1);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const privilegedBody = () => ({ ...dashboardBody(7), users: [user],
  platformBars: [{ label: "Private demographic", value: 3, pct: 100 }],
  activityBars: [{ label: "Private activity count", value: 4, pct: 100 }],
  activities: [{ id: "private", title: "Private backend activity", sub: "Private actor", type: "info" }],
});
function assertSessionLost(setup: ReturnType<typeof fixture>) {
  const view = setup.render(), text = textOf(view);
  assert.match(text, /Admin session has expired or changed|You no longer have Admin access/);
  assert.doesNotMatch(text, /Test Teacher|teacher@example|Private|LIVE|Platform Users|Retry|Could not load/);
  assert.ok(nodesOf(view, n => n.props.href === "/admin/login" && textOf(n) === "Admin Login").length);
  assert.equal(JSON.stringify(setup.states[0]), JSON.stringify(dashboardBody(0).stats));
  for (const index of [1, 2, 3, 4]) assert.equal(JSON.stringify(setup.states[index]), "[]");
  assert.equal(setup.states[6], null, "editing user cleared");
  assert.equal(setup.states[14], null, "freshness timestamp cleared");
  assert.deepEqual(setup.resources(), { clearedTimers: 1, disconnected: 1, unbound: 1, unsubscribed: 1 });
}

for (const status of [401, 403]) {
  test(`Admin success then ${status} clears all data, stops background work and never reads unauthorized body`, async () => {
    const setup = fixture(dashboardPath, [{ ok: true, body: privilegedBody() },
      { ok: false, status, body: { error: "Unauthorized", users: [user], secret: "must-not-render" } }]);
    setup.render(); await setup.ready();
    assert.match(textOf(setup.render()), /Test Teacher/);
    setup.emit("login"); await setup.ready(); assertSessionLost(setup);
    assert.equal(setup.states[13], status);
    assert.equal(setup.bodyReads(), 1);
    setup.emit("register"); setup.tickPoll(); await setup.ready();
    assert.equal(setup.requests(), 2); assertSessionLost(setup);
    assert.ok(setup.signals.at(-1)?.aborted, "authorization-loss request is cancelled");
    setup.restartEffect(); await setup.ready();
    assert.equal(setup.subscriptions(), 1); assert.equal(setup.timers(), 1); assert.equal(setup.requests(), 2);
    setup.unmount(); assert.equal(setup.resources().disconnected, 1);
  });
  test(`Initial ${status}, including a revoked Admin session, shows only reauthentication`, async () => {
    const setup = fixture(dashboardPath, [{ ok: false, status, body: { error: "Unauthorized" } }]);
    setup.render(); await setup.ready(); assertSessionLost(setup);
    assert.equal(setup.states[13], status);
    assert.equal(setup.bodyReads(), 0); setup.unmount();
  });
}
test("older 200 resolving after newer 401 cannot restore privileged data", async () => {
  const old = deferred<Reply>();
  const setup = fixture(dashboardPath, [{ ok: true, body: privilegedBody() }, old.promise, { ok: false, status: 401 }]);
  setup.render(); await setup.ready(); setup.tickPoll(); setup.emit("login"); await setup.ready();
  assertSessionLost(setup); const writes = setup.writes();
  old.resolve({ ok: true, body: privilegedBody() }); await setup.ready();
  assertSessionLost(setup); assert.equal(setup.writes(), writes); assert.equal(setup.bodyReads(), 1); setup.unmount();
});
test("already parsing older 200 is discarded after newer authorization loss", async () => {
  const body = deferred<Record<string, unknown>>();
  const setup = fixture(dashboardPath, [{ ok: true, body: body.promise }, { ok: false, status: 401 }]);
  setup.render(); await setup.ready(); setup.tickPoll(); await setup.ready(); assertSessionLost(setup);
  const writes = setup.writes(); body.resolve(privilegedBody()); await setup.ready();
  assert.equal(setup.writes(), writes); assertSessionLost(setup); setup.unmount();
});
test("network refresh failure keeps stale data/freshness and Retry restores LIVE", async () => {
  const setup = fixture(dashboardPath, [{ ok: true, body: privilegedBody() }, new Error("network unavailable"),
    { ok: true, body: dashboardBody(9) }]);
  setup.render(); await setup.ready(); const timestamp = nodesOf(setup.render(), n => n.type === "time")[0].props.dateTime;
  setup.tickPoll(); await setup.ready();
  assert.match(textOf(setup.render()), /STALE/); assert.doesNotMatch(textOf(setup.render()), /Admin session has expired|LIVE/);
  assert.equal(nodesOf(setup.render(), n => n.type === "time")[0].props.dateTime, timestamp);
  assert.equal(setup.resources().disconnected, 0);
  await setup.retry(); assert.match(textOf(setup.render()), /LIVE/); assert.doesNotMatch(textOf(setup.render()), /STALE/);
  assert.equal((setup.states[0] as { totalUsers: number }).totalUsers, 9); setup.unmount();
});
test("older transient failure cannot replace a newer successful refresh", async () => {
  const old = deferred<Reply>(); const setup = fixture(dashboardPath, [old.promise, { ok: true, body: dashboardBody(9) }]);
  setup.render(); setup.tickPoll(); await setup.ready();
  old.resolve({ ok: false, status: 500 }); await setup.ready();
  assert.match(textOf(setup.render()), /LIVE/); assert.doesNotMatch(textOf(setup.render()), /Could not load|STALE/);
  assert.equal((setup.states[0] as { totalUsers: number }).totalUsers, 9); setup.unmount();
});
test("unmounted requests and queued realtime/poll callbacks cannot write React state", async () => {
  const old = deferred<Reply>(); const setup = fixture(dashboardPath, [old.promise]); setup.render();
  setup.unmount(); const writes = setup.writes();
  old.resolve({ ok: true, body: privilegedBody() }); setup.emit("login"); setup.tickPoll(); await setup.ready();
  assert.equal(setup.writes(), writes); assert.equal(setup.requests(), 1); assert.equal(setup.bodyReads(), 0);
  assert.ok(setup.signals[0].aborted); assert.equal(setup.resources().disconnected, 1);
});
test("effect restart rejects old generation responses/listeners and cleans up both lifecycles", async () => {
  const old = deferred<Reply>(); const setup = fixture(dashboardPath, [old.promise, { ok: true, body: dashboardBody(9) }]);
  setup.render(); const lateActivity = setup.captureActivity(); setup.restartEffect(); await setup.ready();
  const writes = setup.writes(); old.resolve({ ok: true, body: privilegedBody() }); lateActivity({ type: "login" }); await setup.ready();
  assert.equal(setup.writes(), writes); assert.equal(setup.requests(), 2); assert.equal(setup.bodyReads(), 1);
  assert.equal((setup.states[0] as { totalUsers: number }).totalUsers, 9); assert.ok(setup.signals[0].aborted);
  setup.unmount(); assert.deepEqual(setup.resources(), { clearedTimers: 2, disconnected: 2, unbound: 2, unsubscribed: 2 });
});
test("older successful dashboard response cannot replace newer authorized data", async () => {
  const old = deferred<Reply>(); const setup = fixture(dashboardPath, [old.promise, { ok: true, body: dashboardBody(9) }]);
  setup.render(); setup.tickPoll(); await setup.ready(); old.resolve({ ok: true, body: privilegedBody() }); await setup.ready();
  assert.equal((setup.states[0] as { totalUsers: number }).totalUsers, 9);
  assert.doesNotMatch(textOf(setup.render()), /Test Teacher|Private/); setup.unmount();
});
test("pending user-status response cannot restore users or errors after dashboard authorization loss", async () => {
  const action = deferred<Reply>(); const setup = fixture(dashboardPath, [{ ok: true, body: privilegedBody() }, action.promise, { ok: false, status: 401 }]);
  setup.render(); await setup.ready();
  const button = nodesOf(setup.render(), n => n.type === "button" && textOf(n) === "Suspend")[0];
  const pending = (button.props.onClick as () => Promise<void>)();
  setup.tickPoll(); await setup.ready(); assertSessionLost(setup); const writes = setup.writes();
  action.resolve({ ok: true }); await pending; assertSessionLost(setup); assert.equal(setup.writes(), writes); setup.unmount();
});
test("pending subscription response cannot restore modal/users after dashboard authorization loss", async () => {
  const action = deferred<Reply>(); const setup = fixture(dashboardPath, [{ ok: true, body: privilegedBody() }, action.promise, { ok: false, status: 401 }]);
  setup.render(); await setup.ready();
  (nodesOf(setup.render(), n => n.type === "button" && textOf(n) === "Edit")[0].props.onClick as () => void)();
  (nodesOf(setup.render(), n => n.type === "select")[0].props.onChange as (e: unknown) => void)({ target: { value: "Premium" } });
  const form = nodesOf(setup.render(), n => n.type === "form")[0];
  const pending = (form.props.onSubmit as (e: unknown) => Promise<void>)({ preventDefault() {} });
  setup.tickPoll(); await setup.ready(); assertSessionLost(setup); const writes = setup.writes();
  action.resolve({ ok: true }); await pending; assertSessionLost(setup); assert.equal(setup.writes(), writes); setup.unmount();
});
test("Admin re-login mounts a clean dashboard and restores normal loading", async () => {
  const old = fixture(dashboardPath, [{ ok: false, status: 401 }]); old.render(); await old.ready(); assertSessionLost(old); old.unmount();
  // The existing Admin login uses a document navigation to /dashboard/admin.
  const fresh = fixture(dashboardPath, [{ ok: true, body: privilegedBody() }]); fresh.render(); await fresh.ready();
  assert.match(textOf(fresh.render()), /Test Teacher|LIVE/);
  assert.doesNotMatch(textOf(fresh.render()), /Admin session has expired|STALE/);
  assert.equal(fresh.requests(), 1); assert.equal(fresh.subscriptions(), 1); assert.equal(fresh.timers(), 1); fresh.unmount();
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
