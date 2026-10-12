import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { chromium, type Browser, type Page, type BrowserContext } from "playwright";
import { authPresentationMarkup } from "./helpers/auth-presentation-fixture.ts";

// Server-free: node --test tests/auth-native-submission.browser.ts
// Optional actual local fallback: node tests/auth-native-submission.browser.ts http://127.0.0.1:3450
// Synthetic values only. Native fixture requests are aborted; auth APIs are mocked.
const originArgument = process.argv.find(value => /^https?:\/\//.test(value));
const actualOrigin = originArgument ? new URL(originArgument).origin : undefined;
if (actualOrigin) {
  const url = new URL(actualOrigin);
  assert.equal(url.protocol, "http:");
  assert.equal(url.hostname, "127.0.0.1", "actual checks must stay on loopback");
}
const email = "native-canary@example.invalid";
const password = "NativeCanaryPassword739184";
const otp = "739184";
const secrets = [email, password, otp];
function assertNoSecrets(value: string, description: string) {
  for (const secret of secrets) {
    assert.ok(!value.includes(secret) && !value.includes(encodeURIComponent(secret)), description);
  }
}
const sources = [
  { name: "password", file: "src/app/login/content.tsx", fields: ["email", "password"], overrides: {} },
  { name: "OTP", file: "src/app/login/unified-google-signin.tsx", fields: ["otpCode"],
    overrides: { pending: { userId: "synthetic-user", email: "fixture@example.invalid", challenge: "synthetic-challenge" }, otp } },
];
let browser: Browser;
before(async () => { browser = await chromium.launch({ channel: "chrome", headless: true }); });
after(async () => { await browser?.close(); });

async function fill(page: Page, invalid = false) {
  const inputs = page.locator("form input");
  for (let index = 0; index < await inputs.count(); index++) {
    const input = inputs.nth(index), name = await input.getAttribute("name");
    await input.fill(name === "email" ? (invalid ? "invalid-email" : email) : name === "password" ? password : otp);
  }
}
async function submit(page: Page, gesture: string) {
  if (gesture === "Enter") await page.locator("form input").last().press("Enter");
  else if (gesture === "direct submit") await page.locator("form").evaluate(form => (form as HTMLFormElement).submit());
  else await page.locator("form button[type=submit]").click({ noWaitAfter: true });
}
function markup(source: typeof sources[number]) {
  return authPresentationMarkup(source.file, source.overrides);
}
for (const source of sources) for (const mode of ["JavaScript disabled", "blocked client script", "failed client script"]) {
  for (const gesture of ["click", "Enter", "direct submit"]) {
    test(source.name + " native " + gesture + " keeps secrets out of URLs with " + mode, async () => {
      const context = await browser.newContext({ javaScriptEnabled: mode !== "JavaScript disabled", serviceWorkers: "block" });
      try {
        const page = await context.newPage();
        const attempts: Array<{ method: string; fields: string[]; body: string }> = [];
        let recordAttempt: () => void = () => {};
        const recorded = new Promise<void>(resolve => { recordAttempt = resolve; });
        let initial = true;
        await context.route("**/*", async route => {
          const request = route.request(), url = new URL(request.url());
          if (initial && request.isNavigationRequest()) {
            initial = false;
            const script = mode === "blocked client script" ? '<script src="/blocked-client.js"></script>'
              : mode === "failed client script" ? '<script>throw new Error("Synthetic client failure")</script>' : "";
            return route.fulfill({ status: 200, contentType: "text/html",
              headers: { "Content-Security-Policy": "default-src 'none'; script-src 'self' 'unsafe-inline'; form-action 'self'; base-uri 'self'" },
              body: "<!doctype html><html><body>" + markup(source) + script + "</body></html>" });
          }
          if (request.isNavigationRequest()) {
            assertNoSecrets(request.url(), "native request URL must not contain synthetic secrets");
            attempts.push({ method: request.method(), fields: [...url.searchParams.keys()], body: request.postData() || "" });
            recordAttempt();
          }
          return route.abort();
        });
        page.on("pageerror", error => assert.match(error.message, /Synthetic client failure/));
        await page.goto("https://review.invalid/login?reason=session-changed");
        assert.equal(await page.locator("form").getAttribute("method"), "post");
        assert.equal(await page.locator("form").getAttribute("action"), null);
        assert.equal(await page.locator("[formmethod],[formaction]").count(), 0);
        await fill(page);
        const outgoing = page.waitForRequest(request => request.isNavigationRequest() && request.method() === "POST");
        await submit(page, gesture); await outgoing; await recorded;
        assert.equal(attempts.length, 1);
        assert.equal(attempts[0].method, "POST");
        assert.deepEqual(attempts[0].fields, ["reason"]);
        assert.deepEqual([...new URLSearchParams(attempts[0].body).keys()], source.fields);
        const body = new URLSearchParams(attempts[0].body);
        if (source.name === "password") { assert.equal(body.get("email"), email); assert.equal(body.get("password"), password); }
        else assert.equal(body.get("otpCode"), otp);
      } finally { await context.close(); }
    });
  }
}
test("native password form still enforces required and email validation", async () => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage(); let followups = 0, initial = true;
    await context.route("**/*", route => {
      if (initial) { initial = false; return route.fulfill({ contentType: "text/html", body: markup(sources[0]) }); }
      if (route.request().isNavigationRequest()) followups++;
      return route.abort();
    });
    await page.goto("https://review.invalid/login");
    await page.locator("form button[type=submit]").click();
    assert.equal(await page.locator("form").evaluate(form => (form as HTMLFormElement).checkValidity()), false);
    await fill(page, true); await page.locator("form button[type=submit]").click();
    assert.equal(await page.locator("form").evaluate(form => (form as HTMLFormElement).checkValidity()), false);
    await page.waitForTimeout(100); assert.equal(followups, 0);
  } finally { await context.close(); }
});

async function localContext(javaScriptEnabled: boolean, blocked = false) {
  assert.ok(actualOrigin);
  const context = await browser.newContext({ javaScriptEnabled, serviceWorkers: "block" });
  let apiRequests = 0;
  await context.route("**/*", route => {
    const request = route.request(), url = new URL(request.url());
    assertNoSecrets(request.url(), "local request URL must not contain synthetic secrets");
    if (url.origin !== actualOrigin) return route.abort();
    if (url.pathname.startsWith("/api/")) { apiRequests++; return route.abort(); }
    if (blocked && request.resourceType() === "script") return route.abort();
    return route.continue();
  });
  return { context, apiCount: () => apiRequests };
}
async function checkFallback(page: Page, context: BrowserContext, gesture: string) {
  const before = await context.cookies();
  await fill(page);
  const navigationWork = page.waitForNavigation({ waitUntil: "domcontentloaded" });
  const responseWork = page.waitForResponse(response => response.request().isNavigationRequest() && response.request().method() === "POST");
  await submit(page, gesture);
  const response = await responseWork;
  await navigationWork;
  assertNoSecrets(response.url(), "native POST response URL");
  assertNoSecrets(await response.text(), "native POST response body");
  assertNoSecrets(JSON.stringify(response.headers()), "native POST response headers/redirect");
  assert.equal(await response.headerValue("set-cookie"), null, "page POST must not issue cookies");
  assert.deepEqual(await context.cookies(), before, "page POST must not change cookies");
  assertNoSecrets(page.url(), "final page URL");
  // The page may reject POST or simply redisplay the unauthenticated login.
  if (response.status() < 400) {
    assert.equal(await page.locator("#login-password").count(), 1);
    assert.equal(await page.locator("#login-password").inputValue(), "");
  }
  console.log("Actual loopback native fallback status: " + response.status());
}
for (const mode of ["JavaScript disabled", "blocked hydration"]) for (const gesture of ["click", "Enter"]) {
  test("actual local password " + gesture + " safely handles " + mode, { skip: !actualOrigin }, async () => {
    const { context, apiCount } = await localContext(mode !== "JavaScript disabled", mode === "blocked hydration");
    try {
      const page = await context.newPage();
      await page.goto(actualOrigin + "/login?reason=session-changed", { waitUntil: "domcontentloaded" });
      assert.equal(await page.locator("form").getAttribute("method"), "post");
      await checkFallback(page, context, gesture);
      assert.equal(apiCount(), 0);
    } finally { await context.close(); }
  });
}
for (const gesture of ["click", "Enter"]) {
  test("controlled OTP markup uses the actual local POST fallback for " + gesture, { skip: !actualOrigin }, async () => {
    const { context, apiCount } = await localContext(false);
    try {
      const page = await context.newPage();
      await page.goto(actualOrigin + "/login?reason=session-changed", { waitUntil: "domcontentloaded" });
      await page.locator("form").evaluate((form, html) => {
        const source = new DOMParser().parseFromString(html, "text/html").querySelector("form");
        if (!source) throw Error("Missing source-backed OTP form");
        form.replaceWith(source);
      }, markup(sources[1]));
      await checkFallback(page, context, gesture); assert.equal(apiCount(), 0);
    } finally { await context.close(); }
  });
}
test("actual hydrated login keeps JSON, validation, loading, duplicate guard and safe errors", { skip: !actualOrigin }, async () => {
  const { context } = await localContext(true);
  try {
    const page = await context.newPage(); let calls = 0, documentPosts = 0;
    let release: () => void = () => { throw Error("Request not held"); };
    const held = new Promise<void>(resolve => { release = resolve; });
    page.on("request", request => { if (request.isNavigationRequest() && request.method() === "POST") documentPosts++; });
    await context.route(actualOrigin + "/api/auth/login", async route => {
      const request = route.request(); calls++;
      assert.equal(request.method(), "POST");
      assert.match(request.headers()["content-type"], /application\/json/);
      assert.deepEqual(request.postDataJSON(), { email, password });
      await held;
      await route.fulfill({ status: 401, contentType: "application/json", body: '{"error":"synthetic rejection"}' });
    });
    await page.goto(actualOrigin + "/login?reason=session-changed", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => {
      const element = document.querySelector("#login-email");
      return element && Object.keys(element).some(key => key.startsWith("__reactProps$"));
    });
    await page.locator("form button[type=submit]").click();
    assert.equal(calls, 0);
    await fill(page);
    const requested = page.waitForRequest(request => new URL(request.url()).pathname === "/api/auth/login");
    await page.locator("form").evaluate(form => {
      (form as HTMLFormElement).requestSubmit(); (form as HTMLFormElement).requestSubmit();
    });
    await requested;
    assert.equal(calls, 1); assert.equal(documentPosts, 0);
    await page.getByRole("button", { name: "Signing in...", exact: true }).waitFor();
    assert.equal(await page.locator("#login-password").isDisabled(), true);
    release(); await page.getByRole("alert").filter({ hasText: "Invalid email or password." }).waitFor();
    assert.equal(await page.locator("#login-password").isDisabled(), false);
    const retried = page.waitForResponse(response => new URL(response.url()).pathname === "/api/auth/login");
    await page.locator("#login-password").press("Enter");
    await retried;
    assert.equal(calls, 2); assert.equal(documentPosts, 0);
    assertNoSecrets(page.url(), "hydrated page URL");
  } finally { await context.close(); }
});
