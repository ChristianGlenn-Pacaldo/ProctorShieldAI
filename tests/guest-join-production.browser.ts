import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import fs from "node:fs";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, type Browser } from "playwright";
import { authFixture } from "./helpers/auth-fixture.ts";

const origin = "http://127.0.0.1:3123", review = "release-review/guest-join-2026-10-15";
let browser: Browser, server: ChildProcess, log: number;
const results: Array<Record<string, unknown>> = [];
before(async () => {
  fs.mkdirSync(review, { recursive: true });
  try { await fetch(origin + "/login", { signal: AbortSignal.timeout(500) }); throw Error("Port already owned"); }
  catch (e) { if ((e as Error).message === "Port already owned") throw e; }
  execFileSync(process.execPath, ["scripts/prepare-standalone.js"], { stdio: "ignore" });
  // The production server has only test configuration and unreachable providers.
  // Real auth implementations execute separately in the existing in-memory fixture.
  const env: NodeJS.ProcessEnv = { NODE_ENV: "production" };
  for (const key of ["PATH", "Path", "SystemRoot", "WINDIR", "TEMP", "TMP", "USERPROFILE", "LOCALAPPDATA", "APPDATA"])
    if (process.env[key]) env[key] = process.env[key];
  Object.assign(env, {
    NODE_ENV: "production", PORT: "3123", HOSTNAME: "127.0.0.1", FRONTEND_ONLY: "false", POWER_ARENA_ENABLED: "false",
    DATABASE_URL: "postgresql://local:local@127.0.0.1:1/local", REDIS_URL: "redis://127.0.0.1:1",
    NEXTAUTH_SECRET: "fixture-only-session-signing-secret-at-least-32-characters",
    NEXT_PUBLIC_APP_URL: origin, NEXT_PUBLIC_GOOGLE_CLIENT_ID: "synthetic-google-client",
    NEXT_PUBLIC_PUSHER_KEY: "synthetic", NEXT_PUBLIC_PUSHER_CLUSTER: "ap1", PUSHER_APP_ID: "synthetic", PUSHER_SECRET: "synthetic",
    GEMINI_API_KEY: "", S3_ENDPOINT: "", S3_ACCESS_KEY: "", S3_SECRET_KEY: "", S3_BUCKET: "",
    PAYMONGO_SECRET_KEY: "", PAYMONGO_WEBHOOK_SECRET: "", SMTP_PASSWORD: "", GMAIL_OAUTH_CLIENT_SECRET: "", GMAIL_OAUTH_REFRESH_TOKEN: "",
  });
  log = fs.openSync(review + "/production-server.log", "w");
  server = spawn(process.execPath, [".next/standalone/server.js"], { env, stdio: ["ignore", log, log], windowsHide: true });
  let ready = false;
  for (let i = 0; i < 120; i++) {
    if (server.exitCode !== null) throw Error("Owned production server exited");
    try { if ((await fetch(origin + "/login", { signal: AbortSignal.timeout(1000) })).status === 200) { ready = true; break; } } catch {}
    await delay(250);
  }
  assert.ok(ready, "Production server ready");
  browser = await chromium.launch({ headless: true });
});
after(async () => {
  await browser?.close();
  if (server && server.exitCode === null) { const closed = new Promise(resolve => server.once("exit", resolve)); server.kill(); await closed; }
  if (log !== undefined) fs.closeSync(log);
  fs.writeFileSync(review + "/PRODUCTION_BROWSER_RESULTS.json", JSON.stringify({
    checkedAt: new Date().toISOString(),
    scope: "Actual Next production HTTP server, compiled Proxy and production UI. Auth routes/token/cookie/OTP code uses isolated in-memory authFixture; Google SDK/token verification, quiz APIs and retention are synthetic. No configured database, real account, academic record or evidence access.",
    results,
  }, null, 2));
});

const redirectCases = [
  ["/join?code=PS-ABC123", "/login?joinCode=PS-ABC123"],
  ["/join?code=ps-abc123", "/login?joinCode=PS-ABC123"],
  ["/join?code=" + encodeURIComponent(" PS — ABC123 "), "/login?joinCode=PS-ABC123"],
  ["/join", "/login"], ["/join?code=ab", "/login"],
  ["/join?code=" + "A".repeat(65), "/login"],
  ["/join?code=%2F%2Fevil.test&next=https://evil.test", "/login"],
  ["/join?code=PS-ABC123&code=PS-OTHER", "/login"],
  ["/join?code=PS-ABC123&next=https://evil.test&returnTo=//evil.test&role=student", "/login?joinCode=PS-ABC123"],
];
for (const [path, destination] of redirectCases) test("production Proxy signed-out Location: " + path, async () => {
  const response = await fetch(origin + path, { redirect: "manual" });
  assert.equal(response.status, 307);
  assert.equal(response.headers.get("location"), destination);
  assert.equal(new URL(response.headers.get("location")!, origin).href, origin + destination);
  assert.match(response.headers.get("cache-control")!, /no-store/);
  results.push({ case: "actual-proxy-location", path, status: response.status, location: response.headers.get("location"), pass: true });
});

async function scenario(existingRole?: "student" | "teacher" | "admin", loginRole = "student") {
  const auth = authFixture(); auth.environment.NEXT_PUBLIC_APP_URL = origin;
  const context = await browser.newContext();
  const page = await context.newPage(); page.setDefaultTimeout(30000); page.setDefaultNavigationTimeout(60000);
  const calls: Array<{ path: string; method: string; accessCode?: string }> = [], documents: string[] = [], unexpected: string[] = [];
  const syncCookies = async () => {
    await context.clearCookies();
    const cookies = [...auth.allCookies()].map(([name, value]) => ({ name, value, url: origin, httpOnly: true, secure: false, sameSite: "Lax" as const }));
    if (cookies.length) await context.addCookies(cookies);
  };
  if (existingRole) { auth.cookies.set(existingRole === "admin" ? "ps_session_admin" : "ps_session_user", auth.token(existingRole)); await syncCookies(); }
  auth.googleIdentity(loginRole);
  const sdk = 'window.google={accounts:{id:{initialize:function(o){this.o=o},renderButton:function(el){var b=document.createElement("button");b.type="button";b.textContent="Synthetic Google sign-in";b.onclick=()=>this.o.callback({credential:"synthetic-google-credential"});el.appendChild(b)},cancel:function(){},disableAutoSelect:function(){},prompt:function(){}}}};';
  page.on("request", req => { if (req.isNavigationRequest() && req.resourceType() === "document") { const u = new URL(req.url()); if (u.origin === origin) documents.push(u.pathname + u.search); } });
  await page.route("**/*", async route => {
    const req = route.request(), u = new URL(req.url());
    if (u.origin !== origin) {
      if (u.hostname === "accounts.google.com" && u.pathname === "/gsi/client") return route.fulfill({ contentType: "text/javascript", body: sdk });
      return route.abort();
    }
    if (!u.pathname.startsWith("/api/")) return route.continue();
    const body = req.postData() ? req.postDataJSON() : {};
    calls.push({ path: u.pathname, method: req.method(), accessCode: body.accessCode });
    const reply = (json: unknown, status = 200) => route.fulfill({ status, json });
    if (["/api/auth/login", "/api/auth/register", "/api/auth/google", "/api/auth/verify-otp"].includes(u.pathname)) {
      const r = await auth.post(u.pathname.slice(5), body);
      const data = await r.json();
      if (u.pathname === "/api/auth/google" && body.mode === "begin") auth.googleNonce(data.nonce);
      await syncCookies();
      return reply(data, r.status);
    }
    if (u.pathname === "/api/auth/session") {
      const r = await auth.load("src/app/api/auth/session/route.ts").GET(new Request(origin + u.pathname + u.search));
      return reply(await r.json(), r.status);
    }
    const student = await auth.auth.getUserSession("student", { touchActivity: false });
    if (!student) return reply({ error: "Verified Student required" }, 401);
    if (u.pathname === "/api/quizzes") return reply({ quizzes: [] });
    if (u.pathname === "/api/quizzes/join") {
      assert.equal(body.accessCode ?? u.searchParams.get("accessCode"), "PS-ABC123");
      return reply({ success: true, quiz: { id: 99, title: "Synthetic academic quiz", teacher: "Synthetic Teacher", quizMode: "proctored", isArena: false, quizStatus: "in_progress" }, destination: "/quiz/99",
        join: { eligible: true, reviewOnly: false, state: "joinable", message: "" }, arenaSession: null });
    }
    if (u.pathname === "/api/quizzes/99/privacy") return reply({ retentionDays: 37, institution: null, contact: null });
    if (u.pathname === "/api/quizzes/99") return reply({ success: true, userId: student.userId, studentQuizId: "synthetic-attempt", studentQuizStatus: "enrolled", attemptMode: "proctored", canEnterQuiz: true, startTime: null, endTime: null, remainingSeconds: 420, violationCount: 0, savedAnswers: [], quiz: { id: 99, title: "Synthetic academic quiz", duration: 10, quizStatus: "in_progress", quizMode: "proctored", totalQuestions: 1 }, questions: [] });
    unexpected.push(req.method() + " " + u.pathname);
    return reply({ error: "Unexpected synthetic request" }, 500);
  });
  return { page, auth, calls, documents, unexpected, close: () => context.close() };
}
async function reachLogin(f: Awaited<ReturnType<typeof scenario>>) {
  await f.page.goto(origin + "/join?code=PS-ABC123", { waitUntil: "domcontentloaded" });
  assert.equal(f.page.url(), origin + "/login?joinCode=PS-ABC123");
  await f.page.getByText("Sign in with your Student account to continue joining your quiz. Your code is preserved.").waitFor();
  await f.page.getByRole("button", { name: "Synthetic Google sign-in" }).waitFor();
  assert.equal(f.calls.filter(c => c.path.startsWith("/api/quizzes")).length, 0);
}
async function joined(f: Awaited<ReturnType<typeof scenario>>, name: string) {
  await f.page.waitForURL(origin + "/quiz/99");
  await f.page.getByRole("heading", { name: "Your Privacy Matters" }).waitFor();
  await f.page.getByText("Configured evidence retention:").waitFor();
  assert.match(await f.page.locator("body").innerText(), /37 days/);
  assert.equal(f.calls.filter(c => c.path === "/api/quizzes/join" && c.method === "POST").length, 1);
  assert.ok(f.documents.includes("/join?code=PS-ABC123"), "Successful authentication resumes the original invitation");
  assert.equal(f.unexpected.length, 0);
  results.push({ case: name, pass: true, joinPosts: 1, code: "PS-ABC123", actualProductionProxy: true, syntheticAuth: true });
}
test("production guest password flow resumes original code once with actual auth handler", async () => {
  const f = await scenario(); try { await reachLogin(f);
    await f.page.locator("#login-email").fill("student@example.test"); await f.page.locator("#login-password").fill("FixturePassword123");
    await f.page.getByRole("button", { name: "Sign In", exact: true }).click(); await joined(f, "password-intent");
    assert.equal(f.calls.filter(c => c.path === "/api/auth/login").length, 1);
  } finally { await f.close(); }
});
test("production guest Google plus OTP flow resumes original code once", async () => {
  const f = await scenario(); try { await reachLogin(f);
    await f.page.getByRole("button", { name: "Synthetic Google sign-in" }).click();
    await f.page.locator("#google-otp").fill("123456");
    await f.page.getByRole("button", { name: "Verify & Sign In", exact: true }).click(); await joined(f, "google-otp-intent");
    assert.equal(f.calls.filter(c => c.path === "/api/auth/verify-otp").length, 1); assert.equal(f.auth.otps.length, 0);
  } finally { await f.close(); }
});
test("production guest registration preserves code and joins once", async () => {
  const f = await scenario(); try { await reachLogin(f);
    await f.page.getByRole("link", { name: "Create Student Account", exact: true }).click();
    await f.page.waitForURL(origin + "/login/student?tab=register&joinCode=PS-ABC123");
    await f.page.locator("#student-register-name").fill("Synthetic Learner"); await f.page.locator("#student-register-email").fill("new-student@example.test");
    await f.page.locator("#student-register-password").fill("FixturePassword123"); await f.page.locator("#student-register-confirm").fill("FixturePassword123");
    await f.page.locator("form").filter({ has: f.page.locator("#student-register-name") }).locator("button[type=submit]").click();
    await joined(f, "registration-intent"); assert.equal(f.calls.filter(c => c.path === "/api/auth/register").length, 1); assert.equal(f.auth.users.size, 4);
  } finally { await f.close(); }
});
test("production existing Student bypasses login and joins once", async () => {
  const f = await scenario("student"); try { await f.page.goto(origin + "/join?code=PS-ABC123"); await joined(f, "existing-student");
    assert.equal(f.calls.filter(c => ["/api/auth/login", "/api/auth/register"].includes(c.path)).length, 0);
    assert.ok(!f.documents.some(p => p.startsWith("/login")));
  } finally { await f.close(); }
});
for (const role of ["teacher", "admin"] as const) test("production existing " + role + " cannot adopt Student enrollment", async () => {
  const f = await scenario(role); try { await f.page.goto(origin + "/join?code=PS-ABC123");
    if (role === "admin") {
      // scope=user deliberately cannot adopt an Admin-only cookie.
      await f.page.waitForURL(origin + "/login?joinCode=PS-ABC123");
    } else await f.page.getByRole("heading", { name: "Student account required" }).waitFor();
    assert.equal(f.calls.filter(c => c.path.startsWith("/api/quizzes")).length, 0); results.push({ case: role + "-session-isolation", pass: true });
  } finally { await f.close(); }
});
for (const role of ["teacher", "admin"]) test("production password " + role + " cannot follow Student join intent", async () => {
  const f = await scenario(undefined, role); try { await reachLogin(f);
    await f.page.locator("#login-email").fill(role + "@example.test"); await f.page.locator("#login-password").fill("FixturePassword123"); await f.page.getByRole("button", { name: "Sign In", exact: true }).click();
    await f.page.getByRole("alert").filter({ hasText: "Student" }).waitFor(); assert.equal(f.calls.filter(c => c.path.startsWith("/api/quizzes")).length, 0);
    assert.equal(new URL(f.page.url()).pathname, "/login"); results.push({ case: role + "-password-isolation", pass: true });
  } finally { await f.close(); }
});
test("production Google Teacher is never enrolled as Student", async () => {
  const f = await scenario(undefined, "teacher"); try { await reachLogin(f);
    await f.page.getByRole("button", { name: "Synthetic Google sign-in" }).click(); await f.page.locator("#google-otp").fill("123456"); await f.page.getByRole("button", { name: "Verify & Sign In", exact: true }).click();
    await f.page.getByRole("alert").filter({ hasText: "Student account" }).waitFor(); assert.equal(f.calls.filter(c => c.path.startsWith("/api/quizzes")).length, 0); results.push({ case: "google-teacher-isolation", pass: true });
  } finally { await f.close(); }
});
test("production landing cards, privacy endpoint denial and Arena policy remain intact", async () => {
  const page = await browser.newPage(); try {
    await page.route("**/*", r => new URL(r.request().url()).origin === origin ? r.continue() : r.abort());
    await page.goto(origin, { waitUntil: "networkidle" });
    assert.deepEqual(await page.locator("#features article[data-product-feature] h3").allTextContents(), ["Smart Quiz Management", "AI-Assisted Proctoring", "Evidence Review"]);
    assert.doesNotMatch(await page.locator("body").innerText(), /Power Arena|Enter the Arena/);
    assert.equal((await fetch(origin + "/api/quizzes/99/privacy")).status, 401);
    for (const path of ["/arena/99", "/dashboard/teacher/playground", "/api/arena/99"]) {
      const r = await fetch(origin + path, { redirect: "manual" }); assert.equal(r.status, 403); assert.equal((await r.json()).code, "FEATURE_DISABLED");
    }
    results.push({ case: "preserved-features", pass: true });
  } finally { await page.close(); }
});
