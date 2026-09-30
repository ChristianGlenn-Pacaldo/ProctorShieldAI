import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

type ElementNode = { type: string; props: Record<string, unknown> };

function textOf(value: unknown): string {
  if (Array.isArray(value)) return value.map(textOf).join("");
  if (value && typeof value === "object" && "props" in value) return textOf((value as ElementNode).props.children);
  return value === null || value === undefined || typeof value === "boolean" ? "" : String(value);
}

function compile(relativePath: string, jsx = false) {
  const absolutePath = path.resolve(process.cwd(), relativePath);
  return {
    absolutePath,
    code: ts.transpileModule(fs.readFileSync(absolutePath, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: jsx ? ts.JsxEmit.ReactJSX : undefined,
        esModuleInterop: true,
      },
    }).outputText,
  };
}

function listFixture(relativePath: string, responseKey: "users" | "quizzes", initialRows: object[]) {
  const { absolutePath, code } = compile(relativePath, true);
  const states: unknown[] = [];
  let stateIndex = 0;
  let subscribed = false;
  let onActivity: ((payload: { type: string }) => void) | undefined;
  let serverRows = initialRows;
  let fetches = 0;
  const react = {
    useState: (initial: unknown) => {
      const index = stateIndex++;
      if (!(index in states)) states[index] = initial;
      return [states[index], (next: unknown) => {
        states[index] = typeof next === "function" ? (next as (previous: unknown) => unknown)(states[index]) : next;
      }];
    },
    useEffect: (callback: () => void) => {
      if (!subscribed) {
        subscribed = true;
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
      if (name === "pusher-js") return { __esModule: true, default: class {
        subscribe() { return { bind: (_event: string, callback: (payload: { type: string }) => void) => { onActivity = callback; } }; }
        unsubscribe() {}
        disconnect() {}
      } };
      if (name === "lucide-react") return {};
      if (name === "@/lib/backup-write-gate" || name === "./backup-write-gate") return { withBackupWriteGate: (handler: unknown) => handler, runBackupWriteOrReject: (work: () => Promise<unknown>) => work(), runIncidentalBackupWrite: (work: () => Promise<unknown>) => work() };
      throw new Error(`Unexpected dependency: ${name}`);
    },
    fetch: async () => {
      fetches++;
      return { ok: true, json: async () => ({ [responseKey]: serverRows }) };
    },
    process: { env: {} },
    console: { error() {} },
  }, { filename: absolutePath });
  return {
    render: () => { stateIndex = 0; return component.default!(); },
    emit: (type: string) => { assert.ok(onActivity); onActivity({ type }); },
    setRows: (rows: object[]) => { serverRows = rows; },
    rows: () => states[1] as Array<Record<string, unknown>>,
    fetches: () => fetches,
  };
}

test("registration refreshes Admin Users once and repeated refetches do not duplicate rows", async () => {
  const first = { id: "u1", name: "First", email: "first@example.invalid", role: "Teacher", status: "Active", joined: "Today" };
  const second = { id: "u2", name: "Second", email: "second@example.invalid", role: "Student", status: "Active", joined: "Today" };
  const setup = listFixture("src/app/dashboard/admin/users/content.tsx", "users", [first]);
  setup.render();
  await new Promise(setImmediate);
  assert.equal(setup.fetches(), 1);
  setup.setRows([second, first]);
  setup.emit("register");
  await new Promise(setImmediate);
  assert.equal(setup.fetches(), 2);
  assert.deepEqual(setup.rows().map((user) => user.id), ["u2", "u1"]);
  assert.match(textOf(setup.render()), /2 registered users/);

  setup.emit("register");
  setup.emit("unrelated");
  await new Promise(setImmediate);
  assert.equal(setup.fetches(), 3);
  assert.deepEqual(setup.rows().map((user) => user.id), ["u2", "u1"]);
});

test("quiz-deleted refreshes Admin All Quizzes without retaining or duplicating rows", async () => {
  const first = { id: 1, title: "Keep", teacher: { fullName: "Teacher" }, createdAt: "2026-09-01T00:00:00.000Z", quizStatus: "draft" };
  const second = { id: 2, title: "Delete", teacher: { fullName: "Teacher" }, createdAt: "2026-09-01T00:00:00.000Z", quizStatus: "draft" };
  const setup = listFixture("src/app/dashboard/admin/quizzes/content.tsx", "quizzes", [first, second]);
  setup.render();
  await new Promise(setImmediate);
  setup.setRows([first]);
  setup.emit("quiz-deleted");
  await new Promise(setImmediate);
  assert.equal(setup.fetches(), 2);
  assert.deepEqual(setup.rows().map((quiz) => quiz.title), ["Keep"]);
  assert.doesNotMatch(JSON.stringify(setup.render()), /Delete/);

  setup.emit("quiz-deleted");
  setup.emit("register");
  await new Promise(setImmediate);
  assert.equal(setup.fetches(), 3);
  assert.deepEqual(setup.rows().map((quiz) => quiz.title), ["Keep"]);
});

test("dashboard periodically replaces stale presence and cancels its timer on unmount", async () => {
  const { absolutePath, code } = compile("src/app/dashboard/admin/content.tsx", true);
  const states: unknown[] = [];
  let stateIndex = 0;
  let effectStarted = false;
  let cleanup: (() => void) | undefined;
  let interval: (() => void) | undefined;
  let intervalMs = 0;
  let cleared = false;
  let fetches = 0;
  let online = true;
  const react = {
    useState: (initial: unknown) => {
      const index = stateIndex++;
      if (!(index in states)) states[index] = initial;
      return [states[index], (next: unknown) => {
        states[index] = typeof next === "function" ? (next as (previous: unknown) => unknown)(states[index]) : next;
      }];
    },
    useEffect: (callback: () => void | (() => void)) => {
      if (!effectStarted) {
        effectStarted = true;
        cleanup = callback() ?? undefined;
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
      if (name === "lucide-react") return { Users: "icon", FileText: "icon", AlertTriangle: "icon", Brain: "icon" };
      if (name === "pusher-js") return { __esModule: true, default: class {
        subscribe() { return { bind() {} }; }
        unsubscribe() {}
        disconnect() {}
      } };
      if (name === "next/link") return "link";
      if (name === "@/lib/backup-write-gate" || name === "./backup-write-gate") return { withBackupWriteGate: (handler: unknown) => handler, runBackupWriteOrReject: (work: () => Promise<unknown>) => work(), runIncidentalBackupWrite: (work: () => Promise<unknown>) => work() };
      throw new Error(`Unexpected dependency: ${name}`);
    },
    fetch: async () => {
      fetches++;
      return {
        ok: true,
        json: async () => ({
          stats: { totalUsers: online ? 1 : 0, totalQuizzes: 0, totalViolations: 0, aiVerdictsToday: 0 },
          platformBars: [], activityBars: [], activities: [],
          users: [{ id: "u1", name: "Teacher", email: "teacher@example.invalid", isOnline: online }],
        }),
      };
    },
    process: { env: {} },
    setInterval: (callback: () => void, ms: number) => { interval = callback; intervalMs = ms; return 1; },
    clearInterval: (id: number) => { assert.equal(id, 1); cleared = true; },
    console: { error() {} },
  }, { filename: absolutePath });
  stateIndex = 0;
  component.default!();
  await new Promise(setImmediate);
  assert.equal(fetches, 1);
  assert.equal(intervalMs, 30_000);
  assert.equal((states[0] as { totalUsers: number }).totalUsers, 1);
  assert.equal((states[4] as Array<{ isOnline: boolean }>)[0].isOnline, true);

  online = false;
  interval!();
  await new Promise(setImmediate);
  assert.equal(fetches, 2);
  assert.equal((states[0] as { totalUsers: number }).totalUsers, 0);
  assert.equal((states[4] as Array<{ isOnline: boolean }>)[0].isOnline, false);
  cleanup!();
  assert.equal(cleared, true);
});

test("Admin presence requires active status, online flag, and a recent heartbeat", async () => {
  const { absolutePath, code } = compile("src/app/api/dashboard/admin/route.ts");
  const now = Date.now();
  const users = [
    { id: "online", status: "active", isOnline: true, lastSeenAt: new Date(now - 5_000) },
    { id: "logged-out", status: "active", isOnline: false, lastSeenAt: new Date(now) },
    { id: "stale", status: "active", isOnline: true, lastSeenAt: new Date(now - 60_000) },
    { id: "suspended", status: "suspended", isOnline: true, lastSeenAt: new Date(now) },
  ];
  let presenceQuery: { status: string; isOnline: boolean; lastSeenAt: { gte: Date } } | undefined;
  const prisma = {
    user: {
      count: async (query: { where: typeof presenceQuery }) => {
        if ("lastSeenAt" in query.where!) {
          presenceQuery = query.where;
          return users.filter((user) => user.status === query.where!.status
            && user.isOnline === query.where!.isOnline
            && user.lastSeenAt >= query.where!.lastSeenAt.gte).length;
        }
        return 0;
      },
      findMany: async () => users.map((user) => ({
        ...user,
        fullName: user.id,
        email: `${user.id}@example.invalid`,
        createdAt: new Date(now),
        role: { roleName: "teacher" },
        userSubscriptions: [],
      })),
    },
    quiz: { count: async () => 0 },
    violation: { count: async () => 0 },
    aiAnalysis: { count: async () => 0 },
  };
  const route: { GET?: (request: Request) => Promise<Response> } = {};
  vm.runInNewContext(code, {
    exports: route,
    require: (name: string) => {
      if (name === "next/server") return { NextResponse: { json: (body: unknown, options: { status?: number } = {}) =>
        new Response(JSON.stringify(body), { status: options.status ?? 200 }) } };
      if (name === "@/lib/prisma") return { __esModule: true, default: prisma };
      if (name === "@/lib/auth") return { getSession: async () => ({ role: "admin", userId: "admin" }) };
      if (name === "@/lib/backup-write-gate" || name === "./backup-write-gate") return { withBackupWriteGate: (handler: unknown) => handler, runBackupWriteOrReject: (work: () => Promise<unknown>) => work(), runIncidentalBackupWrite: (work: () => Promise<unknown>) => work() };
      throw new Error(`Unexpected dependency: ${name}`);
    },
    console: { error() {} },
  }, { filename: absolutePath });
  const response = await route.GET!(new Request("http://localhost/api/dashboard/admin"));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(presenceQuery?.isOnline, true);
  assert.equal(body.stats.totalUsers, 1);
  assert.deepEqual(body.users.map((user: { isOnline: boolean }) => user.isOnline), [true, false, false, false]);
});
