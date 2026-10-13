import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

type Node = { type: unknown; props: Record<string, any> };
function find(value: any, predicate: (node: Node) => boolean): Node | undefined {
  if (Array.isArray(value)) return value.map(child => find(child, predicate)).find(Boolean);
  if (!value || typeof value !== "object" || !("props" in value)) return undefined;
  return predicate(value) ? value : find(value.props.children, predicate);
}

function settingsFixture() {
  const states: unknown[] = [];
  const effects: Array<() => void> = [];
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  let index = 0;
  let collectEffects = true;
  const react = {
    useState(initial: unknown) {
      const slot = index++;
      if (!(slot in states)) states[slot] = initial;
      return [states[slot], (next: unknown) => { states[slot] = typeof next === "function"
        ? (next as (previous: unknown) => unknown)(states[slot]) : next; }];
    },
    useEffect(effect: () => void) { index++; if (collectEffects) effects.push(effect); },
  };
  const jsx = (type: unknown, props: Node["props"]) => ({ type, props });
  const exports: { default?: () => Node } = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.resolve("src/app/dashboard/student/settings/content.tsx"), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, {
    exports, console, setTimeout() {},
    require(name: string) {
      if (name === "react") return react;
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (name === "lucide-react") return {};
      throw new Error(`Unexpected dependency: ${name}`);
    },
    fetch: async (url: string, init?: RequestInit) => {
      requests.push({ url, init });
      return { json: async () => init ? { success: true } : {
        authenticated: true, user: { fullName: "Disposable QA Student", email: "qa@example.invalid" },
      } };
    },
  });
  const render = () => { index = 0; return exports.default!(); };
  return { render, requests, mount: async () => {
    render(); collectEffects = false; effects.forEach(effect => effect()); await new Promise(setImmediate);
  } };
}

test("Settings keeps theme-aware surfaces, associated input labels and password reveal controls", async () => {
  const setup = settingsFixture(); await setup.mount();
  const tree = setup.render();
  const hero = find(tree, node => String(node.props.className).includes("ps-student-hero"))!;
  assert.ok(hero);
  assert.ok(String(hero.props.className).includes("ps-student-hero"));
  assert.ok(String(hero.props.className).includes("text-[var(--ink)]"));
  for (const id of ["student-full-name", "student-email", "student-current-password", "student-new-password", "student-confirm-password"]) {
    const input = find(tree, node => node.type === "input" && node.props.id === id)!;
    assert.ok(input, id);
    assert.ok(find(tree, node => node.type === "label" && node.props.htmlFor === id));
    assert.ok(String(input.props.className).includes("bg-[var(--surface2)]"));
    assert.ok(String(input.props.className).includes("border-[var(--border)]"));
  }
  assert.equal(find(tree, node => node.props.id === "student-email")!.props.disabled, true);
  const reveal = find(tree, node => node.props["aria-label"] === "Show current password")!;
  reveal.props.onClick();
  assert.equal(find(setup.render(), node => node.props.id === "student-current-password")!.props.type, "text");
  assert.ok(find(setup.render(), node => node.props["aria-label"] === "Hide current password"));
});

test("Settings validation and successful profile feedback retain readable light/dark toast classes", async () => {
  const setup = settingsFixture(); await setup.mount();
  const save = () => find(setup.render(), node => node.type === "button" &&
    String(node.props.className).includes("bg-[var(--ps-primary)]"))!;
  find(setup.render(), node => node.props.id === "student-full-name")!.props.onChange({ target: { value: "" } });
  await save().props.onClick();
  const error = find(setup.render(), node => node.props.role === "alert")!;
  assert.ok(error);
  for (const token of ["bg-[var(--surface)]", "text-[var(--ps-error)]", "[.dark_&]:text-[var(--ps-error)]", "inset-x-4", "sm:max-w-md"]) {
    assert.ok(String(error.props.className).split(" ").includes(token));
  }
  assert.equal(setup.requests.filter(request => request.init?.method === "PUT").length, 0);
  find(setup.render(), node => node.props.id === "student-full-name")!.props.onChange({ target: { value: "Updated QA Student" } });
  await save().props.onClick();
  const success = find(setup.render(), node => node.props.role === "status")!;
  assert.ok(success);
  assert.ok(String(success.props.className).includes("text-[var(--ps-success)] [.dark_&]:text-[var(--ps-success)]"));
  const put = setup.requests.find(request => request.init?.method === "PUT")!;
  assert.equal(put.url, "/api/auth/profile?scope=user&role=student");
  assert.deepEqual(JSON.parse(String(put.init?.body)), { fullName: "Updated QA Student" });
});
