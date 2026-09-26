import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

type ElementNode = { type: string; props: Record<string, unknown> };

function nodesOf(value: unknown, predicate: (element: ElementNode) => boolean): ElementNode[] {
  if (Array.isArray(value)) return value.flatMap((child) => nodesOf(child, predicate));
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const element = value as ElementNode;
  return [
    ...(predicate(element) ? [element] : []),
    ...nodesOf(element.props.children, predicate),
  ];
}

function textOf(value: unknown): string {
  if (Array.isArray(value)) return value.map(textOf).join("");
  if (value && typeof value === "object" && "props" in value) return textOf((value as ElementNode).props.children);
  return value === null || value === undefined || typeof value === "boolean" ? "" : String(value);
}

function fixture(statuses: string[]) {
  const componentPath = path.resolve(process.cwd(), "src/app/dashboard/admin/quizzes/content.tsx");
  const compiled = ts.transpileModule(fs.readFileSync(componentPath, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const states: unknown[] = [];
  const requests: string[] = [];
  let stateIndex = 0;
  let effectStarted = false;
  const react = {
    useState: (initial: unknown) => {
      const index = stateIndex++;
      if (!(index in states)) states[index] = initial;
      return [states[index], (next: unknown) => { states[index] = next; }];
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
  vm.runInNewContext(compiled, {
    exports: component,
    require: (name: string) => {
      if (name === "react") return react;
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (name === "pusher-js") return { __esModule: true, default: class {
        subscribe() { return { bind() {} }; }
        unsubscribe() {}
        disconnect() {}
      } };
      throw new Error(`Unexpected dependency: ${name}`);
    },
    fetch: async (url: string) => {
      requests.push(url);
      return {
        ok: true,
        json: async () => ({ quizzes: statuses.map((status, index) => ({
          id: index + 1,
          title: `Quiz ${index + 1}`,
          teacher: { fullName: "Teacher" },
          createdAt: "2026-09-01T00:00:00.000Z",
          quizStatus: status,
        })) }),
      };
    },
    process: { env: {} },
  }, { filename: componentPath });
  const render = () => {
    stateIndex = 0;
    return component.default!();
  };
  const loaded = async () => {
    const loadingView = render();
    await new Promise(setImmediate);
    return { loadingView, view: render() };
  };
  return { loaded, requests };
}

test("Admin quiz statuses reflect quiz lifecycle instead of falling back to Draft", async () => {
  const statuses = ["draft", "waiting", "active", "in_progress", "ended", "completed", "unrecognized"];
  const expected = ["Draft", "Waiting", "Open", "In Progress", "Ended", "Completed", "Unknown"];
  const setup = fixture(statuses);
  const { view } = await setup.loaded();
  const rows = nodesOf(view, (element) => element.type === "tr");

  assert.deepEqual(setup.requests, ["/api/quizzes"]);
  for (const [index, label] of expected.entries()) {
    const row = rows.find((element) => textOf(element).includes(`Quiz ${index + 1}`));
    assert.ok(row, `Quiz ${index + 1} is rendered`);
    const badge = nodesOf(row, (element) => element.type === "span")[0];
    assert.equal(textOf(badge), label);
  }
  const inProgressRow = rows.find((element) => textOf(element).includes("Quiz 4"))!;
  const endedRow = rows.find((element) => textOf(element).includes("Quiz 5"))!;
  for (const index of [1, 7]) {
    const row = rows.find((element) => textOf(element).includes(`Quiz ${index}`))!;
    const badgeClass = String(nodesOf(row, (element) => element.type === "span")[0].props.className);
    assert.match(badgeClass, /text-\[var\(--muted\)\]/);
    assert.doesNotMatch(badgeClass, /text-white/);
  }
  assert.match(String(nodesOf(inProgressRow, (element) => element.type === "span")[0].props.className), /blue/);
  assert.match(String(nodesOf(endedRow, (element) => element.type === "span")[0].props.className), /emerald/);
});

test("Admin quiz list removes the inert details action in populated, loading, and empty states", async () => {
  const populated = await fixture(["draft"]).loaded();
  assert.doesNotMatch(textOf(populated.view), /View Details|Actions/);
  assert.equal(nodesOf(populated.view, (element) => element.type === "th").length, 4);
  assert.equal(nodesOf(populated.view, (element) => element.type === "button").length, 0);
  assert.equal(nodesOf(populated.loadingView, (element) => element.type === "td" && element.props.colSpan === 4).length, 1);

  const empty = await fixture([]).loaded();
  assert.match(textOf(empty.view), /No quizzes found in the system/);
  assert.equal(nodesOf(empty.view, (element) => element.type === "td" && element.props.colSpan === 4).length, 1);
});
