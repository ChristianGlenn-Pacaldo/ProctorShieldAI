import { fetchAuth } from "../src/lib/auth-request.ts";
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { authFixture } from "./helpers/auth-fixture.ts";
import { getAuthDestination } from "../src/lib/auth-destination.ts";

type Node = { type: unknown; props: Record<string, unknown> };
function nodes(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const node = value as Node; return [node, ...nodes(node.props.children)];
}
function text(value: unknown): string {
  if (Array.isArray(value)) return value.map(text).join("");
  if (value && typeof value === "object" && "props" in value) return text((value as Node).props.children);
  return value == null || typeof value === "boolean" ? "" : String(value);
}
type Fetcher = (url: string, init: RequestInit) => Promise<Response>;
function ui(path: string, fetcher: Fetcher, clientId = "fixture-client") {
  const states: unknown[] = [], effects: Array<() => void | (() => void)> = [], cleanup: Array<() => void> = [];
  let index = 0, mounted = false, tree: unknown;
  const calls: Array<{ url: string; init: RequestInit }> = [], destinations: string[] = [];
  const state = (initial: unknown) => {
    const slot = index++; if (!(slot in states)) states[slot] = initial;
    return [states[slot], (next: unknown) => { states[slot] = typeof next === "function" ? next(states[slot]) : next; }];
  };
  const exports: { default?: () => unknown } = {};
  const code = ts.transpileModule(fs.readFileSync(path, "utf8"), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  vm.runInNewContext(code, {
    exports, URL, AbortController, process: { env: { NEXT_PUBLIC_GOOGLE_CLIENT_ID: clientId } },
    window: { location: { origin: "https://app.example.test", assign: (url: string) => destinations.push(url) } },
    fetch: async (url: string, init: RequestInit) => { calls.push({ url, init }); return fetcher(url, init); },
    require(name: string) {
      if (name === "react") return { useState: state, useRef: (value: unknown) => state({ current: value })[0],
        useEffect: (effect: () => void | (() => void)) => { if (!mounted) effects.push(effect); } };
      if (name === "react/jsx-runtime") return { jsx: (type: unknown, props: Node["props"]) => ({ type, props }),
        jsxs: (type: unknown, props: Node["props"]) => ({ type, props }), Fragment: "fragment" };
      if (name === "next/link") return { __esModule: true, default: "a" };
      if (name === "next/navigation") return { useRouter: () => ({ push: (url: string) => destinations.push(url) }) };
      if (name === "lucide-react") return new Proxy({}, { get: (_target, name) => String(name) });
      if (name === "@react-oauth/google") return { GoogleOAuthProvider: "GoogleOAuthProvider", GoogleLogin: "GoogleLogin" };
      if (name === "@/lib/auth-request") return { fetchAuth };
      if (name === "@/lib/auth-destination") return { getAuthDestination };
      if (name === "./unified-google-signin") return { __esModule: true, default: "UnifiedGoogleSignIn" };
      if (name === "@/lib/subscription-rules") return { FREE_MANUAL_QUIZ_LIMIT: 3, FREE_STUDENT_LIMIT_PER_QUIZ: 50,
        PRO_MONTHLY_PRICE_PHP: 499, PRO_STUDENT_LIMIT_PER_QUIZ: 100 };
      throw new Error(`Unexpected dependency: ${name}`);
    },
  }, { filename: path });
  const render = () => {
    index = 0; tree = exports.default!();
    if (!mounted) { mounted = true; for (const effect of effects) { const work = effect(); if (work) cleanup.push(work); } }
    return nodes(tree);
  };
  const find = (predicate: (node: Node) => boolean) => {
    const result = render().find(predicate); assert.ok(result, "Expected UI control"); return result;
  };
  render();
  return { render, find, calls, destinations,
    content: () => { render(); return text(tree); },
    unmount: () => { for (const work of cleanup) work(); },
    ready: async () => { for (let turn = 0; turn < 8; turn++) await new Promise(resolve => setImmediate(resolve)); render(); },
  };
}
const googlePath = "src/app/login/unified-google-signin.tsx";
async function readyGoogle(fetcher: Fetcher) {
  const page = ui(googlePath, fetcher); await page.ready();
  (page.find(n => n.type === "GoogleOAuthProvider").props.onScriptLoadSuccess as () => void)();
  return page;
}
function success(page: ReturnType<typeof ui>) {
  return page.find(n => n.type === "GoogleLogin").props.onSuccess as (value: { credential: string }) => Promise<void>;
}
function submit(page: ReturnType<typeof ui>, digits = "123456") {
  (page.find(n => n.props.id === "google-otp").props.onChange as (e: unknown) => void)({ target: { value: digits } });
  return (page.find(n => n.type === "form").props.onSubmit as (e: unknown) => Promise<void>)({ preventDefault() {} });
}
function actualFetcher(f: ReturnType<typeof authFixture>): Fetcher {
  return async (url, init) => {
    const body = JSON.parse(String(init.body));
    const response = await f.post(url.replace("/api/", ""), body);
    if (body.mode === "begin" && response.ok) f.googleNonce((await response.clone().json()).nonce);
    return response;
  };
}

test("public login has one generic password form, one unified Google component, explicit registration, and no Admin or social-provider options", () => {
  const page = ui("src/app/login/content.tsx", async () => { throw new Error("Render must not fetch"); });
  const tree = page.render();
  assert.equal(tree.filter(n => n.type === "form").length, 1);
  assert.equal(tree.filter(n => n.type === "UnifiedGoogleSignIn").length, 1);
  assert.equal(tree.filter(n => n.type === "select" || n.props.name === "role").length, 0);
  for (const [label, href] of [["Create Student Account", "/login/student?tab=register"],
    ["Create Teacher Account", "/login/teacher?tab=register"], ["Forgot Password?", "/login/forgot-password"]]) {
    assert.equal(page.find(n => n.type === "a" && text(n.props.children) === label).props.href, href);
  }
  assert.doesNotMatch(page.content(), /Admin|Microsoft|Apple|Facebook|GitHub|Student Google Sign In|Teacher Google Sign In/);
  assert.equal(page.calls.length, 0); assert.equal(page.destinations.length, 0);
});

test("password submission unmounts the Google subtree so pending callbacks are disposed", async () => {
  let resolve!: (r: Response) => void;
  const page = ui("src/app/login/content.tsx", () => new Promise(done => { resolve = done; }));
  for (const [id, value] of [["login-email", "student@example.test"], ["login-password", "FixturePassword123"]]) {
    (page.find(n => n.props.id === id).props.onChange as (e: unknown) => void)({ target: { value } });
  }
  const work = (page.find(n => n.type === "form").props.onSubmit as (e: unknown) => Promise<void>)({ preventDefault() {} });
  assert.equal(page.render().filter(n => n.type === "UnifiedGoogleSignIn").length, 0);
  resolve(Response.json({}, { status: 401 })); await work;
  assert.equal(page.render().filter(n => n.type === "UnifiedGoogleSignIn").length, 1);
});

test("public login welcomes returning users with a named form and associated field labels", () => {
  const page = ui("src/app/login/content.tsx", async () => { throw new Error("Render must not fetch"); });
  const heading = page.find(n => n.type === "h1");
  assert.equal(text(heading.props.children), "Welcome Back");
  assert.equal(page.find(n => n.type === "form").props["aria-labelledby"], heading.props.id);
  assert.match(page.content(), /Sign in to your ProctorShieldAI account/);
  assert.match(page.content(), /Don't have an account\?/);
  for (const [id, label, autocomplete] of [["login-email", "Email Address", "username"], ["login-password", "Password", "current-password"]]) {
    assert.equal(text(page.find(n => n.type === "label" && n.props.htmlFor === id).props.children), label);
    const input = page.find(n => n.type === "input" && n.props.id === id);
    assert.equal(input.props.autoComplete, autocomplete);
    assert.equal(input.props.required, true);
  }
  assert.equal(page.calls.length, 0);
});

test("password visibility control exposes its target and state without submitting or clearing input", () => {
  const page = ui("src/app/login/content.tsx", async () => { throw new Error("Visibility must not fetch"); });
  (page.find(n => n.props.id === "login-password").props.onChange as (e: unknown) => void)({ target: { value: "FixturePassword123" } });
  const control = page.find(n => n.props["aria-label"] === "Show password");
  assert.equal(control.props.type, "button");
  assert.equal(control.props["aria-controls"], "login-password");
  assert.equal(control.props["aria-pressed"], false);
  (control.props.onClick as () => void)();
  assert.equal(page.find(n => n.props.id === "login-password").props.type, "text");
  const hide = page.find(n => n.props["aria-label"] === "Hide password");
  assert.equal(hide.props["aria-pressed"], true);
  (hide.props.onClick as () => void)();
  const input = page.find(n => n.props.id === "login-password");
  assert.equal(input.props.type, "password");
  assert.equal(input.props.value, "FixturePassword123");
  assert.equal(page.calls.length, 0);
});

for (const role of ["student", "teacher"]) test(`${role} actual Google + OTP flow navigates only after verified OTP to the allowlisted DB destination`, async () => {
  const f = authFixture(); f.googleIdentity(role);
  const page = await readyGoogle(actualFetcher(f));
  const button = page.find(n => n.type === "GoogleLogin");
  assert.equal(button.props.text, "continue_with"); assert.equal(button.props.useOneTap, false); assert.equal(button.props.auto_select, false);
  await success(page)({ credential: "verified-fixture" });
  assert.equal(f.cookies.size, 0); assert.deepEqual(page.destinations, []);
  assert.equal(page.render().filter(n => n.props.id === "google-otp").length, 1);
  const request = JSON.parse(String(page.calls[1].init.body));
  assert.deepEqual(Object.keys(request).sort(), ["credential", "intent", "mode"]); assert.equal(request.mode, "signin");
  await submit(page);
  assert.deepEqual(page.destinations, [`https://app.example.test/dashboard/${role}`]);
  assert.equal(f.cookies.has("ps_session_admin"), false);
  page.unmount();
});

test("unknown Google account shows safe registration guidance while preserving the identity and never navigating", async () => {
  const f = authFixture(); f.googleIdentity("unknown");
  const page = await readyGoogle(actualFetcher(f)); await success(page)({ credential: "verified-fixture" });
  assert.match(page.content(), /No existing account was found.*Create a Student or Teacher account/);
  assert.equal(f.users.size, 3); assert.equal(f.cookies.size, 0); assert.deepEqual(page.destinations, []);
  page.unmount();
});

for (const role of ["admin", "owner", "//evil.example.test", ["student"], undefined]) {
  test(`OTP result with ${JSON.stringify(role)} role never selects an arbitrary destination`, async () => {
    const f = authFixture(); f.googleIdentity("student");
    const backend = actualFetcher(f);
    const page = await readyGoogle((url, init) => url.endsWith("verify-otp")
      ? Promise.resolve(Response.json({ success: true, user: { role } })) : backend(url, init));
    await success(page)({ credential: "verified-fixture" }); await submit(page);
    assert.deepEqual(page.destinations, []); assert.match(page.content(), /Unable to confirm/); page.unmount();
  });
}

test("Google success without MFA is refused even if response contains a valid role", async () => {
  const page = await readyGoogle(async (_url, init) => JSON.parse(String(init.body)).mode === "begin"
    ? Response.json({ intent: "intent-fixture", nonce: "nonce-fixture" }) : Response.json({ success: true, user: { role: "student" } }));
  await success(page)({ credential: "verified-fixture" });
  assert.deepEqual(page.destinations, []); assert.match(page.content(), /Unable to confirm/); page.unmount();
});

test("duplicate Google callbacks and OTP submits issue one mutation while pending", async () => {
  const f = authFixture(); f.googleIdentity("student"); const backend = actualFetcher(f);
  let release!: () => void;
  let wait = new Promise<void>(done => { release = done; });
  const page = await readyGoogle(async (url, init) => { if (JSON.parse(String(init.body)).mode !== "begin") await wait; return backend(url, init); });
  const callback = success(page), work = callback({ credential: "verified-fixture" });
  await callback({ credential: "duplicate-fixture" }); assert.equal(page.calls.length, 2);
  release(); await work;
  wait = new Promise<void>(done => { release = done; });
  const verify = submit(page); await submit(page); assert.equal(page.calls.length, 3);
  release(); await verify; assert.equal(page.destinations.length, 1); page.unmount();
});

test("wrong OTP is retryable, six-digit input is enforced, and server messages are never rendered", async () => {
  const f = authFixture(); f.googleIdentity("student"); const page = await readyGoogle(actualFetcher(f));
  await success(page)({ credential: "verified-fixture" });
  await submit(page, "123"); assert.equal(page.calls.length, 2); assert.match(page.content(), /6-digit/);
  await submit(page, "654321"); assert.equal(f.cookies.size, 0); assert.deepEqual(page.destinations, []);
  await submit(page); assert.equal(page.destinations.length, 1); page.unmount();
});

test("cancelled Google callbacks and detached OTP forms cannot issue another request", async () => {
  const f = authFixture(); f.googleIdentity("student"); const page = await readyGoogle(actualFetcher(f));
  const callback = success(page); await callback({ credential: "verified-fixture" });
  (page.find(n => n.props.id === "google-otp").props.onChange as (e: unknown) => void)({ target: { value: "123456" } });
  const verify = page.find(n => n.type === "form").props.onSubmit as (e: unknown) => Promise<void>;
  (page.find(n => n.type === "button" && text(n.props.children) === "Start again").props.onClick as () => void)();
  await callback({ credential: "old-fixture" }); await verify({ preventDefault() {} });
  assert.equal(page.calls.length, 2); assert.deepEqual(page.destinations, []); assert.equal(f.cookies.size, 0); page.unmount();
});

test("unmount aborts requests and ignores delayed Google/OTP UI completion", async () => {
  const f = authFixture(); f.googleIdentity("student"); const backend = actualFetcher(f);
  let resolve!: (r: Response) => void;
  const page = await readyGoogle((url, init) => JSON.parse(String(init.body)).mode === "begin" ? backend(url, init)
    : new Promise(done => { resolve = done; }));
  const callback = success(page), work = callback({ credential: "verified-fixture" });
  page.unmount(); assert.equal(page.calls[1].init.signal?.aborted, true);
  resolve(Response.json({ success: true, requiresMfa: true, role: "student", userId: "student", email: "student@example.test", challenge: "fixture" }));
  await work; await callback({ credential: "detached" });
  assert.equal(page.calls.length, 2); assert.deepEqual(page.destinations, []);
});

test("missing Google configuration keeps a single unavailable action and password guidance without network calls", () => {
  const page = ui(googlePath, async () => { throw new Error("No provider request"); }, "");
  assert.equal(page.render().filter(n => n.type === "button" && text(n.props.children) === "Continue with Google").length, 1);
  assert.match(page.content(), /Use email and password/); assert.equal(page.calls.length, 0); page.unmount();
});

test("homepage bottom CTA has one unified sign-in link and preserves surrounding content and responsive styling", () => {
  const page = ui("src/app/page.tsx", async () => { throw new Error("No auth on homepage render"); });
  const section = page.find(n => n.type === "section" && text(n.props.children).includes("Ready to secure your next examination?"));
  const links = nodes(section).filter(n => n.type === "a");
  assert.equal(links.length, 1); assert.equal(links[0].props.href, "/login");
  assert.equal(text(links[0].props.children), "Sign In to ProctorShield");
  assert.doesNotMatch(text(section), /Enter Room as Student|Launch Quiz as Teacher|Admin/);
  assert.match(String(links[0].props.className), /md:text-base/);
  assert.match(page.content(), /Join thousands of educators/);
  assert.match(page.content(), /Real-Time AI Face & Gaze Detection/);
  assert.equal(page.calls.length, 0); assert.deepEqual(page.destinations, []);
});


test("fresh Google UI completes bootstrap before rendering one provider action", async () => {
  const f = authFixture();
  const page = await readyGoogle(async (url, init) => {
    const result = await f.deferredPost(url.replace("/api/", ""), JSON.parse(String(init.body))); result.apply();
    if (result.response.ok) f.googleNonce((await result.response.clone().json()).nonce);
    return result.response;
  });
  assert.equal(page.calls.length, 2);
  assert.ok(page.calls.every(c => JSON.parse(String(c.init.body)).mode === "begin"));
  assert.equal(page.render().filter(n => n.type === "GoogleLogin").length, 1);
  assert.equal(f.cookies.size, 0); assert.equal(f.otps.length, 0); assert.equal(f.mail.length, 0);
  page.unmount();
});

test("Google bootstrap does not loop when cookies cannot be retained", async () => {
  const page = ui(googlePath, async () => Response.json({ success: false, code: "BROWSER_AUTH_INITIALIZED" }, { status: 409 }));
  await page.ready(); assert.equal(page.calls.length, 2);
  assert.equal(page.render().filter(n => n.type === "GoogleLogin").length, 0);
  assert.match(page.content(), /Google sign-in is unavailable/); page.unmount();
});
