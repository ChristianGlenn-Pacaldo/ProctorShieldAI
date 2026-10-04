import assert from "node:assert/strict";
import test from "node:test";
import jwt from "jsonwebtoken";
import { authFixture } from "./helpers/auth-fixture.ts";

type Fixture = ReturnType<typeof authFixture>;
const binding = (f: Fixture) => f.load("src/lib/browser-auth.ts").readBrowserAuthentication();
const session = (f: Fixture) => f.auth.getSession(undefined, { touchActivity: false });
const registration = (role: string) => ({ fullName: "New Registration", email: `new-${role}@example.test`, password: "FixturePassword123", role });
async function login(f: Fixture, role: string) {
  assert.equal((await f.post("auth/login", { email: `${role}@example.test`, password: "FixturePassword123" })).status, 200);
}
function pauseIssuance(f: Fixture) {
  const original = f.auth.setSessionCookie;
  let reached!: () => void, resume!: () => void, first = true;
  const paused = new Promise<void>(resolve => { reached = resolve; });
  const gate = new Promise<void>(resolve => { resume = resolve; });
  f.auth.setSessionCookie = async (...args: unknown[]) => {
    if (first) { first = false; reached(); await gate; }
    return original(...args);
  };
  return { paused, resume };
}
function charges(f: Fixture, prefix: string) {
  return f.rateCalls.filter(call => call.keys.some(key => key.startsWith(prefix + ":"))).length;
}

for (const [older, newer] of [["student", "admin"], ["teacher", "student"]]) {
  test(`older ${older} password registration cannot adopt newer ${newer} login`, async () => {
    const f = authFixture(); await f.post("auth/google", { mode: "begin" });
    const pause = pauseIssuance(f), old = f.deferredPost("auth/register", registration(older));
    await pause.paused;
    try {
      await login(f, newer); const before = await binding(f), jar = f.allCookies();
      pause.resume(); const result = await old; result.apply();
      assert.equal(result.response.status, 401);
      assert.notEqual((await result.response.json()).code, "BROWSER_AUTH_INITIALIZED");
      assert.deepEqual(f.allCookies(), jar); assert.deepEqual(await binding(f), before);
      assert.equal((await session(f)).role, newer);
      assert.equal(f.users.get("new-user")!.role.roleName, older); // Account remains; no destructive cleanup.
    } finally { pause.resume(); }
  });
}

for (const loss of ["missing", "expired", "changed-deadline"]) {
  test(`registration final issuance after ${loss} browser state never bootstraps or retries account creation`, async () => {
    const f = authFixture(); await f.post("auth/google", { mode: "begin" });
    const before = await binding(f), key = "proctorshield:browser-auth:" + before.browserId;
    const pause = pauseIssuance(f), old = f.deferredPost("auth/register", registration("student"));
    await pause.paused; const now = Date.now, jar = f.allCookies();
    try {
      if (loss === "missing") f.generations.values.delete(key);
      if (loss === "expired") Date.now = () => before.expiresAt * 1000;
      if (loss === "changed-deadline") f.generations.values.set(key, `${before.authGeneration}|${before.expiresAt + 100}`);
      const records = new Map(f.generations.values);
      pause.resume(); const result = await old; result.apply();
      assert.equal(result.response.status, 401);
      assert.notEqual((await result.response.json()).code, "BROWSER_AUTH_INITIALIZED");
      assert.deepEqual(f.allCookies(), jar); assert.equal(f.users.size, 4);
      assert.equal(f.cookies.size, 0); assert.equal(charges(f, "register"), 1);
      if (loss !== "expired") assert.deepEqual(f.generations.values, records);
    } finally { Date.now = now; pause.resume(); }
  });
}

test("final issuance without an explicit binding fails without creating browser state", async () => {
  const f = authFixture(), user = f.users.get("student")!;
  await assert.rejects(f.auth.setSessionCookie({ userId: user.id, email: user.email, fullName: user.fullName, role: "student" }, f.snapshot("student")), /Authentication changed/);
  assert.equal(f.browserCookies.size, 0); assert.equal(f.generations.values.size, 0); assert.equal(f.cookies.size, 0);
});

test("legacy Student Google registration completion cannot adopt newer Teacher login", async () => {
  const f = authFixture(); f.users.delete("student"); f.googleIdentity("student");
  const pending = await (await f.post("auth/google", { credential: "fixture", role: "student" })).json();
  const pause = pauseIssuance(f), old = f.deferredPost("auth/verify-otp", { userId: pending.userId, otpCode: "123456" });
  await pause.paused;
  try {
    await login(f, "teacher"); const before = await binding(f), jar = f.allCookies();
    pause.resume(); const result = await old; result.apply();
    assert.equal(result.response.status, 401); assert.deepEqual(f.allCookies(), jar);
    assert.deepEqual(await binding(f), before); assert.equal((await session(f)).role, "teacher");
    assert.equal(f.users.has("new-user"), true);
  } finally { pause.resume(); }
});

test("externally revoked retained Teacher token cannot cancel anonymous Google intent through logout", async () => {
  const a = authFixture(), b = authFixture(a.backend);
  await login(a, "teacher"); await login(b, "teacher");
  assert.equal((await b.post("auth/logout")).status, 200); assert.equal(await session(a), null);
  const intent = await (await a.post("auth/google", { mode: "begin" })).json();
  a.googleIdentity("student"); a.googleNonce(intent.nonce);
  const before = await binding(a), jar = a.allCookies();
  const logout = await a.post("auth/logout");
  assert.equal((await logout.json()).serverRevocation, "not_required");
  assert.deepEqual(await binding(a), before); assert.deepEqual(a.allCookies(), jar);
  const callback = await a.post("auth/google", { mode: "signin", intent: intent.intent, credential: "fixture" });
  assert.equal(callback.status, 200); assert.equal(a.mail.length, 1); assert.equal(a.otps.length, 1);
});

for (const kind of ["none", "malformed", "expired", "wrong-class", "revoked", "inactive", "deleted", "obsolete", "changed-role"]) {
  test(`${kind} session logout cannot rotate the current browser generation`, async () => {
    const f = authFixture(); await login(f, "teacher");
    if (kind === "none") f.cookies.clear();
    if (kind === "malformed") f.cookies.set("ps_session_user", "malformed");
    if (kind === "expired") f.cookies.set("ps_session_user", jwt.sign({ ...(jwt.decode(f.cookies.get("ps_session_user")!) as jwt.JwtPayload), exp: 1 }, f.environment.NEXTAUTH_SECRET));
    if (kind === "wrong-class") { const token = f.cookies.get("ps_session_user")!; f.cookies.clear(); f.cookies.set("ps_session_admin", token); }
    if (kind === "revoked") f.users.get("teacher")!.sessionVersion++;
    if (kind === "inactive") f.users.get("teacher")!.status = "inactive";
    if (kind === "deleted") f.users.delete("teacher");
    if (kind === "obsolete") await f.load("src/lib/browser-auth.ts").advanceBrowserAuthentication(await binding(f));
    if (kind === "changed-role") f.users.get("teacher")!.role.roleName = "student";
    assert.equal(await session(f), null); const before = await binding(f), jar = f.allCookies();
    const result = await f.deferredPost("auth/logout"); result.apply();
    assert.equal(result.response.status, 200); assert.deepEqual(result.response.headers.getSetCookie(), []);
    assert.deepEqual(await binding(f), before); assert.deepEqual(f.allCookies(), jar);
    assert.equal(f.logs.length, 0);
  });
}

for (const role of ["student", "teacher", "admin"]) test(`current ${role} logout still revokes the account and its own generation`, async () => {
  const f = authFixture(); await login(f, role); const before = await binding(f), jar = f.allCookies();
  const response = await f.post("auth/logout");
  assert.equal(response.status, 200); assert.equal(f.users.get(role)!.sessionVersion, 1);
  assert.notEqual((await binding(f)).authGeneration, before.authGeneration);
  assert.deepEqual(f.allCookies(), jar); assert.equal(await session(f), null);
});

test("already validated same-account logout retains Phase 1 account-wide ordering", async () => {
  const f = authFixture(); await login(f, "student");
  const original = f.auth.getSession; let reached!: () => void, resume!: () => void;
  const paused = new Promise<void>(r => { reached = r; }), gate = new Promise<void>(r => { resume = r; });
  f.auth.getSession = async (...args: unknown[]) => { const result = await original(...args); reached(); await gate; return result; };
  const old = f.deferredPost("auth/logout"); await paused;
  try {
    await login(f, "student"); const before = await binding(f), jar = f.allCookies();
    resume(); const result = await old; result.apply(); f.auth.getSession = original;
    assert.equal(result.response.status, 200); assert.equal(f.users.get("student")!.sessionVersion, 1);
    assert.deepEqual(await binding(f), before); assert.deepEqual(f.allCookies(), jar); assert.equal(await session(f), null);
  } finally { resume(); f.auth.getSession = original; }
});

for (const role of ["admin", "teacher", "student"]) test(`fresh ${role} password login uses its last auth attempt only on the retry`, async () => {
  const f = authFixture(); f.rateRemaining.set(`login:account:${role}@example.test`, 1);
  const body = { email: `${role}@example.test`, password: "FixturePassword123" };
  const first = await f.deferredPost("auth/login", body); first.apply();
  assert.equal(first.response.status, 409); assert.equal(charges(f, "login"), 0);
  assert.equal(f.rateRemaining.get(`login:account:${role}@example.test`), 1);
  const retry = await f.deferredPost("auth/login", body); retry.apply();
  assert.equal(retry.response.status, 200); assert.equal(charges(f, "login"), 1);
  assert.equal((await session(f)).role, role);
  assert.equal((await f.post("auth/login", body)).status, 429); assert.equal((await session(f)).role, role);
});

for (const role of ["student", "teacher"]) test(`fresh ${role} registration uses one remaining attempt and creates one account`, async () => {
  const f = authFixture(), body = registration(role); f.rateRemaining.set(`register:account:${body.email}`, 1);
  const first = await f.deferredPost("auth/register", body); first.apply();
  assert.equal(first.response.status, 409); assert.equal(f.users.size, 3); assert.equal(charges(f, "register"), 0);
  const retry = await f.deferredPost("auth/register", body); retry.apply();
  assert.equal(retry.response.status, 201); assert.equal(f.users.size, 4); assert.equal(charges(f, "register"), 1);
  assert.equal((await session(f)).role, role);
  assert.equal((await f.post("auth/register", body)).status, 429); assert.equal(f.users.size, 4);
});

test("fresh Google begin spends one intent attempt after bootstrap and sends one OTP", async () => {
  const f = authFixture(); f.rateRemaining.set("google-intent:ip:fixture", 1); f.rateRemaining.set("google-auth:account:student@example.test", 1);
  const first = await f.deferredPost("auth/google", { mode: "begin" }); first.apply();
  assert.equal(first.response.status, 409); assert.equal(charges(f, "google-intent"), 0); assert.equal(charges(f, "google-auth"), 0);
  assert.equal(f.otps.length, 0); assert.equal(f.mail.length, 0);
  const retry = await f.deferredPost("auth/google", { mode: "begin" }); retry.apply();
  assert.equal(retry.response.status, 200); assert.equal(charges(f, "google-intent"), 1);
  const intent = await retry.response.json(); f.googleNonce(intent.nonce); f.googleIdentity("student");
  assert.equal((await f.post("auth/google", { mode: "begin" })).status, 429);
  assert.equal((await f.post("auth/google", { mode: "signin", intent: intent.intent, credential: "fixture" })).status, 200);
  assert.equal(charges(f, "google-auth"), 1); assert.equal(f.otps.length, 1); assert.equal(f.mail.length, 1);
});

test("wrong OTP still consumes verification budget after bootstrap", async () => {
  const f = authFixture(); f.rateRemaining.set("verify-otp:account:student", 1);
  const first = await f.deferredPost("auth/verify-otp", { userId: "student", otpCode: "654321" }); first.apply();
  assert.equal(first.response.status, 409); assert.equal(charges(f, "verify-otp"), 0);
  assert.equal((await f.post("auth/verify-otp", { userId: "student", otpCode: "654321" })).status, 401);
  assert.equal(charges(f, "verify-otp"), 1);
  assert.equal((await f.post("auth/verify-otp", { userId: "student", otpCode: "654321" })).status, 429);
});

for (const route of ["auth/login", "auth/register", "auth/google", "auth/verify-otp"]) test(`${route} initialization has independent abuse protection`, async () => {
  const f = authFixture(); f.rateRemaining.set("browser-auth-init:ip:fixture", 0);
  const body = route === "auth/login" ? { email: "student@example.test", password: "FixturePassword123" }
    : route === "auth/register" ? registration("student") : route === "auth/google" ? { mode: "begin" } : { userId: "student", otpCode: "123456" };
  const response = await f.post(route, body);
  assert.equal(response.status, 429); assert.ok(Number(response.headers.get("Retry-After")) > 0);
  assert.equal(f.browserCookies.size, 0); assert.equal(f.generations.values.size, 0); assert.equal(f.users.size, 3);
  assert.equal(f.mail.length, 0); assert.equal(f.rateCalls.length, 1);
});
