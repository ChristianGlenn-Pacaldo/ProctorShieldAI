import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { getAuthDestination } from "../src/lib/auth-destination.ts";
import { authFixture } from "./helpers/auth-fixture.ts";

type Node = { type: unknown; props: Record<string, unknown> & {
  onChange?: (event: { target: { value: string } }) => void;
  onSubmit?: (event: { preventDefault: () => void }) => Promise<void>;
  onClick?: () => void;
} };
type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

function nodes(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const node = value as Node;
  return [node, ...nodes(node.props.children)];
}

function text(value: unknown): string {
  if (Array.isArray(value)) return value.map(text).join("");
  if (value && typeof value === "object" && "props" in value) return text((value as Node).props.children);
  return value === null || value === undefined || typeof value === "boolean" ? "" : String(value);
}

function ui(fetcher: Fetcher, path = "src/app/login/page.tsx", search = "") {
  const states: unknown[] = [];
  let index = 0;
  let mounted = false;
  let tree: unknown;
  const effects: Array<() => void> = [];
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const destinations: string[] = [];
  const state = (initial: unknown) => {
    const slot = index++;
    if (!(slot in states)) states[slot] = initial;
    return [states[slot], (next: unknown) => {
      states[slot] = typeof next === "function" ? next(states[slot]) : next;
    }];
  };
  const exports: { default?: () => unknown } = {};
  const code = ts.transpileModule(fs.readFileSync(path, "utf8"), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  vm.runInNewContext(code, {
    exports, URL, URLSearchParams, process: { env: { NEXT_PUBLIC_GOOGLE_CLIENT_ID: "fixture-client" } },
    console: { error() {} },
    localStorage: { getItem: () => null, removeItem() {} },
    window: { location: { search, origin: "https://app.example.test", assign: (url: string) => destinations.push(url),
      set href(url: string) { destinations.push(url); } } },
    fetch: async (url: string, init: RequestInit) => { calls.push({ url, init }); return fetcher(url, init); },
    require(name: string) {
      if (name === "react") return { useState: state, useRef: (value: unknown) => state({ current: value })[0],
        useEffect: (effect: () => void) => { if (!mounted) effects.push(effect); } };
      if (name === "react/jsx-runtime") return { jsx: (type: unknown, props: Node["props"]) => ({ type, props }),
        jsxs: (type: unknown, props: Node["props"]) => ({ type, props }), Fragment: "fragment" };
      if (name === "next/link") return { __esModule: true, default: "a" };
      if (name === "lucide-react") return new Proxy({}, { get: (_target, name) => String(name) });
      if (name === "@react-oauth/google") return { GoogleOAuthProvider: "GoogleOAuthProvider", GoogleLogin: "GoogleLogin" };
      if (name === "@/lib/auth-destination") return { getAuthDestination };
      throw new Error(`Unexpected UI dependency: ${name}`);
    },
  }, { filename: path });
  const render = () => {
    index = 0; tree = exports.default!();
    if (!mounted) {
      mounted = true;
      for (const effect of effects) effect();
      index = 0; tree = exports.default!();
    }
    return nodes(tree);
  };
  const find = (predicate: (node: Node) => boolean) => {
    const result = render().find(predicate);
    assert.ok(result, "Expected UI control");
    return result;
  };
  const fill = (email = "student@example.test", password = "FixturePassword123") => {
    find(node => node.type === "input" && node.props.type === "email").props.onChange!({ target: { value: email } });
    find(node => node.type === "input" && node.props.type === "password").props.onChange!({ target: { value: password } });
  };
  return { render, find, fill, calls, destinations,
    submit: () => find(node => node.type === "form").props.onSubmit!({ preventDefault() {} }),
    content: () => { render(); return text(tree); },
  };
}

for (const role of ["admin", "teacher", "student"]) {
  test(`unified ${role} credentials use the real password route without role and issue only their class cookie`, async () => {
    const fixture = authFixture();
    for (const name of ["ps_session_admin", "ps_session_user", "ps_session_teacher", "ps_session_student"]) fixture.cookies.set(name, "old");
    const page = ui(async (url, init) => {
      assert.equal(url, "/api/auth/login");
      assert.equal(init.method, "POST");
      assert.equal((init.headers as Record<string, string>)["Content-Type"], "application/json");
      const body = JSON.parse(String(init.body));
      assert.deepEqual(body, { email: `${role}@example.test`, password: "FixturePassword123" });
      return fixture.post("auth/login", body);
    });
    page.fill(`${role}@example.test`);
    await page.submit();
    assert.deepEqual(page.destinations, [`https://app.example.test/dashboard/${role}`]);
    assert.deepEqual([...fixture.cookies.keys()], [role === "admin" ? "ps_session_admin" : "ps_session_user"]);
    assert.equal(page.find(node => node.type === "button" && node.props.type === "submit").props.disabled, true);
  });
}

test("destination helper rejects unknown, malformed, inherited and URL roles", () => {
  for (const role of [undefined, null, {}, [], 1, "Admin", "teacher ", "owner", "__proto__", "constructor", "//evil.test", "/dashboard/admin"]) {
    assert.equal(getAuthDestination(role), null);
  }
});

for (const [name, body] of [
  ["unknown role", { success: true, user: { role: "owner" } }],
  ["malformed role", { success: true, user: { role: ["admin"] } }],
  ["missing user", { success: true, role: "admin" }],
  ["missing success", { user: { role: "admin" } }],
  ["false success", { success: false, user: { role: "admin" } }],
  ["unexpected MFA", { success: true, requiresMfa: true, user: { role: "admin" } }],
  ["null JSON", null],
  ["array JSON", []],
] as const) test(`${name} response never navigates`, async () => {
  const page = ui(async () => Response.json(body));
  page.fill(); await page.submit();
  assert.deepEqual(page.destinations, []);
  assert.match(page.content(), /Unable to confirm your account/);
});

test("invalid JSON and transient network failure are safe and retryable", async () => {
  let attempt = 0;
  const page = ui(async () => { if (++attempt === 1) return new Response("<html>internal detail</html>"); throw new Error("private connection string"); });
  page.fill(); await page.submit();
  assert.match(page.content(), /Unable to confirm/);
  await page.submit();
  assert.match(page.content(), /check your connection/);
  assert.doesNotMatch(page.content(), /private|internal detail/);
  assert.deepEqual(page.destinations, []);
  assert.equal(page.find(node => node.type === "button" && node.props.type === "submit").props.disabled, false);
});

for (const [status, expected] of [
  [401, /Invalid email or password/], [403, /not allowed/], [429, /Too many sign-in attempts/], [500, /Unable to sign in/],
] as const) test(`HTTP ${status} exposes only a safe error without navigating`, async () => {
  const page = ui(async () => Response.json({ success: true, user: { role: "admin" }, message: "private stack or secret" }, { status }));
  page.fill(); await page.submit();
  assert.match(page.content(), expected);
  assert.doesNotMatch(page.content(), /private stack|secret/);
  assert.deepEqual(page.destinations, []);
});

for (const scenario of ["invalid", "suspended", "inactive"] as const) test(`real password API ${scenario} response stays on the form`, async () => {
  const fixture = authFixture();
  if (scenario !== "invalid") fixture.users.get("student")!.status = scenario;
  const page = ui(async (_url, init) => fixture.post("auth/login", JSON.parse(String(init.body))));
  page.fill("student@example.test", scenario === "invalid" ? "IncorrectPassword123" : "FixturePassword123");
  await page.submit();
  assert.deepEqual(page.destinations, []);
  assert.equal(fixture.cookies.size, 0);
  assert.match(page.content(), scenario === "invalid" ? /Invalid email or password/ : /not allowed/);
});

test("same-tick and loading submissions issue one request, then failure permits retry", async () => {
  let resolve!: (response: Response) => void;
  const pending = new Promise<Response>(done => { resolve = done; });
  const page = ui(async () => pending);
  page.fill();
  const handler = page.find(node => node.type === "form").props.onSubmit!;
  const first = handler({ preventDefault() {} });
  await handler({ preventDefault() {} });
  assert.equal(page.calls.length, 1);
  assert.equal(page.find(node => node.type === "button" && node.props.type === "submit").props.disabled, true);
  assert.equal(page.find(node => node.type === "form").props["aria-busy"], true);
  assert.ok(page.render().filter(node => node.type === "input").every(node => node.props.disabled));
  await page.submit();
  assert.equal(page.calls.length, 1);
  resolve(Response.json({}, { status: 401 }));
  await first;
  await page.submit();
  assert.equal(page.calls.length, 2);
});

test("empty credentials do not submit", async () => {
  const page = ui(async () => { throw new Error("Must not fetch"); });
  await page.submit();
  assert.equal(page.calls.length, 0);
  assert.match(page.content(), /Enter your email and password/);
});

test("one form has accessible credentials, visibility toggle and compatibility links without session side effects", () => {
  const page = ui(async () => { throw new Error("Rendering must not fetch"); });
  const rendered = page.render();
  assert.equal(rendered.filter(node => node.type === "form").length, 1);
  assert.equal(rendered.filter(node => node.type === "input").length, 2);
  assert.equal(rendered.filter(node => node.type === "select" || node.props.name === "role").length, 0);
  assert.equal(page.find(node => node.props.id === "login-email").props.autoComplete, "username");
  assert.equal(page.find(node => node.props.id === "login-password").props.autoComplete, "current-password");
  for (const [label, href] of [
    ["Create Student Account", "/login/student?tab=register"], ["Create Teacher Account", "/login/teacher?tab=register"],
    ["Forgot Password?", "/login/forgot-password"], ["Student Google Sign In", "/login/student"], ["Teacher Google Sign In", "/login/teacher"],
  ]) assert.equal(page.find(node => node.type === "a" && text(node.props.children) === label).props.href, href);
  page.find(node => node.props["aria-label"] === "Show password").props.onClick!();
  assert.equal(page.find(node => node.props.id === "login-password").props.type, "text");
  page.find(node => node.props["aria-label"] === "Hide password").props.onClick!();
  assert.equal(page.find(node => node.props.id === "login-password").props.type, "password");
  assert.equal(page.calls.length, 0); assert.deepEqual(page.destinations, []);
});

for (const role of ["student", "teacher", "admin"]) test(`legacy ${role} password page still renders and signs in`, async () => {
  const fixture = authFixture();
  const path = role === "admin" ? "src/app/admin/login/page.tsx" : `src/app/login/${role}/page.tsx`;
  const page = ui(async (_url, init) => fixture.post("auth/login", JSON.parse(String(init.body))), path);
  page.fill(`${role}@example.test`); await page.submit();
  assert.deepEqual(page.destinations, [`/dashboard/${role}`]);
  assert.equal(JSON.parse(String(page.calls[0].init.body)).role, role);
});

for (const role of ["student", "teacher"]) test(`create ${role} link opens the existing registration panel without authentication`, () => {
  const page = ui(async () => { throw new Error("No registration on render"); }, `src/app/login/${role}/page.tsx`, "?tab=register");
  assert.ok(page.render().filter(node => node.type === "input").length >= 4);
  assert.equal(page.calls.length, 0);
  assert.deepEqual(page.destinations, []);
});
