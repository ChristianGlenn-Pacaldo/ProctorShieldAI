import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const componentPath = path.resolve(process.cwd(), "src/app/dashboard/admin/content.tsx");
const compiled = ts.transpileModule(fs.readFileSync(componentPath, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText;

type ElementNode = { type: string; props: Record<string, unknown> };
type Activity = { icon: string; title: string; sub: string; type: string };

function fixture() {
  const states: unknown[] = [];
  let stateIndex = 0;
  let effectStarted = false;
  let onActivity: ((payload: unknown) => void) | undefined;
  let dashboardFetches = 0;
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
  class PusherClient {
    subscribe() {
      return { bind: (_event: string, callback: (payload: unknown) => void) => { onActivity = callback; } };
    }
    unsubscribe() {}
    disconnect() {}
  }
  const exports: { default?: () => ElementNode } = {};
  vm.runInNewContext(compiled, {
    exports,
    require: (name: string) => {
      if (name === "react") return react;
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (name === "lucide-react") return { Users: "icon", FileText: "icon", AlertTriangle: "icon", Brain: "icon" };
      if (name === "pusher-js") return PusherClient;
      if (name === "next/link") return "link";
      return {};
    },
    fetch: async () => {
      dashboardFetches++;
      if (dashboardFetches > 1) return new Promise(() => {});
      return {
        ok: true,
        json: async () => ({
          stats: { totalUsers: 0, totalQuizzes: 0, totalViolations: 0, aiVerdictsToday: 0 },
          platformBars: [], activityBars: [], activities: [], users: [],
        }),
      };
    },
    process: { env: {} },
    console: { error() {} },
  }, { filename: componentPath });

  const render = () => {
    stateIndex = 0;
    return exports.default!();
  };
  return {
    render,
    emit: (payload: unknown) => { assert.ok(onActivity); onActivity(payload); },
    activities: () => states[3] as Activity[],
    dashboardFetches: () => dashboardFetches,
  };
}

test("valid user_update renders its committed suspend activity", async () => {
  const setup = fixture();
  setup.render();
  await new Promise(setImmediate);
  setup.emit({ type: "user_update", fullName: "QA Teacher", role: "teacher", activity: "Admin suspended user: QA Teacher" });

  assert.doesNotThrow(() => setup.render());
  assert.equal(setup.activities()[0].title, "Admin suspended user: QA Teacher");
  assert.equal(setup.activities()[0].sub, "QA Teacher (TEACHER) · just now");
  assert.equal(setup.activities()[0].type, "info");
  assert.equal(setup.dashboardFetches(), 2);
});

test("missing or malformed user_update display fields cannot crash the dashboard", async () => {
  const setup = fixture();
  setup.render();
  await new Promise(setImmediate);
  assert.doesNotThrow(() => setup.emit({ type: "user_update", fullName: 42, role: {}, activity: null }));
  assert.doesNotThrow(() => setup.render());
  assert.equal(setup.activities()[0].title, "Platform activity");
  assert.equal(setup.activities()[0].sub, "Unknown user (USER) · just now");
});

test("unrelated login activity retains its existing rendering", async () => {
  const setup = fixture();
  setup.render();
  await new Promise(setImmediate);
  setup.emit({ type: "login", fullName: "QA Student", role: "student", activity: "Logged in as student" });

  assert.doesNotThrow(() => setup.render());
  assert.equal(setup.activities()[0].title, "Logged in as student");
  assert.equal(setup.activities()[0].sub, "QA Student (STUDENT) · just now");
  assert.equal(setup.activities()[0].icon, "👤");
  assert.equal(setup.activities()[0].type, "info");
});
