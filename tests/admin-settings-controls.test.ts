import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const componentPath = path.resolve(process.cwd(), "src/app/dashboard/admin/settings/content.tsx");
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

function fixture(options: {
  sessionOk?: boolean;
  save?: () => Promise<{ ok: boolean; json: () => Promise<{ success: boolean; message?: string }> }>;
} = {}) {
  const states: unknown[] = [];
  const profileRequests: Array<{ url: string; body: Record<string, string> }> = [];
  let stateIndex = 0;
  let effectStarted = false;
  let refreshes = 0;
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
  const exports: { default?: () => ElementNode } = {};
  vm.runInNewContext(compiled, {
    exports,
    require: (name: string) => {
      if (name === "react") return react;
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (name === "next/navigation") return { useRouter: () => ({ refresh: () => { refreshes++; } }) };
      return {};
    },
    fetch: async (url: string, request?: { method?: string; body?: string }) => {
      if (url === "/api/auth/session") {
        return { ok: options.sessionOk !== false, json: async () => ({ authenticated: true, user: { fullName: "QA Admin", email: "qa@example.invalid" } }) };
      }
      assert.equal(url, "/api/auth/profile");
      assert.equal(request?.method, "PUT");
      profileRequests.push({ url, body: JSON.parse(request?.body || "{}") });
      return options.save ? options.save() : { ok: true, json: async () => ({ success: true }) };
    },
  }, { filename: componentPath });

  const render = () => {
    stateIndex = 0;
    return exports.default!();
  };
  const loaded = async () => {
    render();
    await new Promise(setImmediate);
    return render();
  };
  const button = (root: ElementNode, label: string) => findElement(root, (element) =>
    element.type === "button" && textOf(element) === label)!;
  const input = (root: ElementNode, id: string) => findElement(root, (element) => element.type === "input" && element.props.id === id)!;
  const form = (root: ElementNode) => findElement(root, (element) => element.type === "form")!;

  return { render, loaded, button, input, form, profileRequests, getRefreshes: () => refreshes };
}

test("unsupported global settings are clearly unavailable and cannot be saved", async () => {
  const setup = fixture();
  const view = await setup.loaded();

  const systemName = findElement(view, (element) => element.type === "input" && element.props.value === "Proctor Shield AI")!;
  assert.equal(systemName.props.disabled, true);
  assert.equal(setup.button(view, "Save Configuration").props.disabled, true);
  assert.match(textOf(view), /Global configuration is not available yet/);
  assert.equal((textOf(view).match(/Unavailable/g) || []).length, 2);
  assert.equal(setup.profileRequests.length, 0);
});

test("Admin full-name save uses the existing profile API and refreshes the session layout", async () => {
  const setup = fixture();
  const initial = await setup.loaded();
  assert.equal(setup.button(initial, "Save Changes").props.disabled, true);
  setup.input(initial, "admin-full-name").props.onChange({ target: { value: "  Updated Admin  " } });
  await setup.form(setup.render()).props.onSubmit({ preventDefault() {} });
  const view = setup.render();

  assert.equal(setup.profileRequests.length, 1);
  assert.equal(setup.profileRequests[0].body.fullName, "Updated Admin");
  assert.match(textOf(view), /Profile updated successfully/);
  assert.match(textOf(view), /Updated Admin/);
  assert.equal(setup.button(view, "Save Changes").props.disabled, true);
  assert.equal(setup.getRefreshes(), 1);
});

test("Admin full-name save shows loading and keeps the old name on failed HTTP responses", async () => {
  let finishSave: ((response: { ok: boolean; json: () => Promise<{ success: boolean; message: string }> }) => void) | undefined;
  const setup = fixture({ save: () => new Promise((resolve) => { finishSave = resolve; }) });
  const initial = await setup.loaded();
  setup.input(initial, "admin-full-name").props.onChange({ target: { value: "New Admin" } });
  const pending = setup.form(setup.render()).props.onSubmit({ preventDefault() {} });
  assert.equal(setup.button(setup.render(), "Saving...").props.disabled, true);

  finishSave!({ ok: false, json: async () => ({ success: false, message: "Unable to update profile" }) });
  await pending;
  const view = setup.render();
  assert.match(textOf(view), /Unable to update profile/);
  assert.match(textOf(view), /QA Admin/);
  assert.equal(setup.getRefreshes(), 0);
  assert.equal(setup.button(view, "Save Changes").props.disabled, false);
});

test("invalid names and unavailable sessions cannot submit profile changes", async () => {
  const setup = fixture();
  const initial = await setup.loaded();
  setup.input(initial, "admin-full-name").props.onChange({ target: { value: " " } });
  await setup.form(setup.render()).props.onSubmit({ preventDefault() {} });
  assert.match(textOf(setup.render()), /Name must be between 2 and 150 characters/);
  assert.equal(setup.profileRequests.length, 0);

  const missingSession = fixture({ sessionOk: false });
  const view = await missingSession.loaded();
  assert.match(textOf(view), /Could not load your profile/);
  assert.equal(missingSession.button(view, "Save Changes").props.disabled, true);
});
