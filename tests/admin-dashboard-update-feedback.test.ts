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

type ElementNode = { type: string; props: Record<string, any> };

function textOf(value: unknown): string {
  if (Array.isArray(value)) return value.map(textOf).join("");
  if (value && typeof value === "object" && "props" in value) return textOf((value as ElementNode).props.children);
  return value === null || value === undefined || typeof value === "boolean" ? "" : String(value);
}

function findElement(root: unknown, predicate: (element: ElementNode) => boolean): ElementNode | undefined {
  if (Array.isArray(root)) {
    for (const child of root) {
      const match = findElement(child, predicate);
      if (match) return match;
    }
  } else if (root && typeof root === "object" && "props" in root) {
    const element = root as ElementNode;
    if (predicate(element)) return element;
    return findElement(element.props.children, predicate);
  }
  return undefined;
}

function fixture(status: "Active" | "Suspended", plan: "Premium" | "Free Tier", succeeds: boolean) {
  const initialUser = {
    id: "teacher-1", name: "QA Teacher", email: "qa@example.invalid", role: "Teacher", roleClass: "",
    plan, status, statusClass: "", isOnline: false, subscription: "", subClass: "", joined: "Today",
  };
  let serverUser = { ...initialUser };
  const states: unknown[] = [];
  let stateIndex = 0;
  let dashboardFetches = 0;
  const requests: Array<Record<string, string>> = [];
  const react = {
    useState: (initial: unknown) => {
      const index = stateIndex++;
      if (!(index in states)) states[index] = index === 4 ? [initialUser] : initial;
      return [states[index], (next: unknown) => {
        states[index] = typeof next === "function" ? (next as (previous: unknown) => unknown)(states[index]) : next;
      }];
    },
    useEffect: () => {},
  };
  const jsx = (type: string, props: Record<string, any>) => ({ type, props });
  const exports: { default?: () => ElementNode } = {};
  vm.runInNewContext(compiled, {
    exports,
    require: (name: string) => {
      if (name === "react") return react;
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (name === "lucide-react") return { Users: "icon", FileText: "icon", AlertTriangle: "icon", Brain: "icon" };
      return {};
    },
    fetch: async (url: string, options?: { method?: string; body?: string }) => {
      if (options?.method === "PUT") {
        const body = JSON.parse(options.body || "{}") as Record<string, string>;
        requests.push(body);
        if (succeeds) {
          if (body.status) serverUser = { ...serverUser, status: body.status === "suspended" ? "Suspended" : "Active" };
          if (body.plan) serverUser = { ...serverUser, plan: body.plan as "Premium" | "Free Tier" };
        }
        return { ok: succeeds };
      }
      assert.equal(url, "/api/dashboard/admin");
      dashboardFetches++;
      return {
        ok: true,
        json: async () => ({ stats: {}, platformBars: [], activityBars: [], activities: [], users: [{ ...serverUser }] }),
      };
    },
    console: { error() {} },
  }, { filename: componentPath });

  const render = () => {
    stateIndex = 0;
    return exports.default!();
  };
  const button = (root: ElementNode, label: string) => findElement(root, (element) =>
    element.type === "button" && textOf(element) === label)!;
  const row = (root: ElementNode) => findElement(root, (element) =>
    element.type === "tr" && textOf(element).includes("QA Teacher"))!;
  const error = (root: ElementNode) => findElement(root, (element) => element.props.role === "alert");

  return { render, button, row, error, getRequests: () => requests, getDashboardFetches: () => dashboardFetches };
}

for (const [initialStatus, action] of [["Active", "Suspend"], ["Suspended", "Restore"]] as const) {
  test(`failed ${action.toLowerCase()} keeps the persisted ${initialStatus.toLowerCase()} state`, async () => {
    const setup = fixture(initialStatus, "Free Tier", false);
    await setup.button(setup.render(), action).props.onClick();
    const view = setup.render();

    assert.match(textOf(setup.row(view)), new RegExp(initialStatus));
    assert.ok(setup.button(view, action));
    assert.match(textOf(setup.error(view)), /Changes were not saved/);
    assert.equal(setup.getDashboardFetches(), 1);
  });
}

for (const [initialStatus, action, finalStatus] of [
  ["Active", "Suspend", "Suspended"],
  ["Suspended", "Restore", "Active"],
] as const) {
  test(`successful ${action.toLowerCase()} updates the displayed status`, async () => {
    const setup = fixture(initialStatus, "Free Tier", true);
    await setup.button(setup.render(), action).props.onClick();
    const view = setup.render();

    assert.match(textOf(setup.row(view)), new RegExp(finalStatus));
    assert.equal(setup.error(view), undefined);
    assert.equal(setup.getDashboardFetches(), 1);
  });
}

for (const succeeds of [false, true]) {
  test(`${succeeds ? "successful" : "failed"} subscription save ${succeeds ? "updates the table" : "keeps the modal open and table unchanged"}`, async () => {
    const setup = fixture("Active", "Free Tier", succeeds);
    setup.button(setup.render(), "Edit").props.onClick();
    const select = findElement(setup.render(), (element) => element.type === "select")!;
    select.props.onChange({ target: { value: "Premium" } });
    const form = findElement(setup.render(), (element) => element.type === "form")!;
    await form.props.onSubmit({ preventDefault() {} });
    const view = setup.render();

    assert.equal(setup.getRequests()[0].plan, "Premium");
    assert.equal(setup.getDashboardFetches(), 1);
    assert.match(textOf(setup.row(view)), succeeds ? /Premium/ : /Free Tier/);
    assert.equal(Boolean(findElement(view, (element) => element.type === "form")), !succeeds);
    if (succeeds) assert.equal(setup.error(view), undefined);
    else assert.match(textOf(setup.error(view)), /Changes were not saved/);
  });
}
