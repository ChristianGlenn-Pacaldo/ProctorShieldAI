import assert from "node:assert/strict";
import test from "node:test";
import jwt from "jsonwebtoken";
import { authFixture } from "./helpers/auth-fixture.ts";

type Fixture = ReturnType<typeof authFixture>;
async function pending(f: Fixture, role = "student") {
  f.googleIdentity(role);
  const begin = await f.post("auth/google", { mode: "begin" });
  assert.equal(begin.status, 200);
  const intent = await begin.json(); f.googleNonce(intent.nonce);
  const response = await f.post("auth/google", { mode: "signin", intent: intent.intent, credential: "fixture" });
  assert.equal(response.status, 200);
  const body = await response.json();
  return { userId: body.userId, challenge: body.challenge, otpCode: "123456" };
}
async function password(f: Fixture, role: string) {
  assert.equal((await f.post("auth/login", { email: `${role}@example.test`, password: "FixturePassword123" })).status, 200);
}
async function identity(f: Fixture) { return f.auth.getSession(undefined, { touchActivity: false }); }
function pauseOldIssuance(f: Fixture) {
  const original = f.auth.setSessionCookie;
  let reached!: () => void, resume!: () => void;
  const paused = new Promise<void>(resolve => { reached = resolve; });
  const gate = new Promise<void>(resolve => { resume = resolve; });
  let first = true;
  f.auth.setSessionCookie = async (...args: unknown[]) => {
    if (first) { first = false; reached(); await gate; }
    return original(...args);
  };
  return { paused, resume };
}

for (const [older, newer, method] of [
  ["student", "teacher", "password"], ["teacher", "student", "password"],
  ["student", "admin", "password"], ["teacher", "admin", "password"],
  ["student", "student", "password"],
  ["student", "teacher", "google"], ["teacher", "student", "google"], ["student", "student", "google"],
] as const) test(`in-flight ${older} OTP cannot supersede newer ${newer} ${method} authentication`, async () => {
  const f = authFixture(), body = await pending(f, older), pause = pauseOldIssuance(f);
  // Pause after early validation/OTP consumption, before final commitment.
  const old = f.post("auth/verify-otp", body); await pause.paused;
  try {
    if (method === "password") await password(f, newer);
    else assert.equal((await f.post("auth/verify-otp", await pending(f, newer))).status, 200);
    const before = f.allCookies(), current = await identity(f);
    assert.equal(current.userId, newer);
    pause.resume(); assert.equal((await old).status, 401);
    assert.deepEqual(f.allCookies(), before);
    assert.equal((await identity(f)).authGeneration, current.authGeneration);
    assert.equal(f.cookies.has("ps_session_admin"), newer === "admin");
    assert.equal(f.cookies.has("ps_session_user"), newer !== "admin");
  } finally { pause.resume(); }
});

for (const starting of ["student", "teacher", "admin"]) {
  test(`logout of ${starting} invalidates an in-flight Student OTP regardless of account`, async () => {
    const f = authFixture(); if (starting !== "anonymous") await password(f, starting);
    const body = await pending(f), pause = pauseOldIssuance(f);
    const old = f.post("auth/verify-otp", body); await pause.paused;
    try {
      assert.equal((await f.post("auth/logout")).status, 200);
      if (starting !== "anonymous") assert.equal(f.users.get(starting)!.sessionVersion, 1);
      const before = f.allCookies();
      pause.resume(); assert.equal((await old).status, 401);
      assert.deepEqual(f.allCookies(), before); assert.equal(await identity(f), null);
    } finally { pause.resume(); }
  });
}

for (const [older, newer] of [["student", "teacher"], ["teacher", "student"], ["student", "admin"], ["admin", "student"], ["student", "student"]]) {
  test(`late ${older} response cannot authorize obsolete generation after ${newer} response`, async () => {
    const f = authFixture(); await f.post("auth/google", { mode: "begin" });
    // Same established browser ID, independent incoming cookie snapshots, and
    // reverse response delivery after both authoritative commits.
    const a = await f.deferredPost("auth/login", { email: `${older}@example.test`, password: "FixturePassword123" });
    assert.equal(a.response.status, 200);
    const b = await f.deferredPost("auth/login", { email: `${newer}@example.test`, password: "FixturePassword123" });
    assert.equal(b.response.status, 200);
    b.apply(); assert.equal((await identity(f)).userId, newer);
    const newerToken = f.cookies.get(newer === "admin" ? "ps_session_admin" : "ps_session_user")!;
    const newerClaims = f.auth.verifyToken(newerToken);
    a.apply();
    const olderToken = f.cookies.get(older === "admin" ? "ps_session_admin" : "ps_session_user")!;
    assert.notEqual(f.auth.verifyToken(olderToken).authGeneration, newerClaims.authGeneration);
    assert.equal(await f.auth.getAdminSession({ touchActivity: false }), null);
    assert.equal(await f.auth.getUserSession(undefined, { touchActivity: false }), null);
    f.cookies.clear(); f.cookies.set(newer === "admin" ? "ps_session_admin" : "ps_session_user", newerToken);
    assert.equal((await identity(f)).userId, newer);
  });
}

test("independent anonymous B cannot redeem A challenge, while A can complete its own OTP", async () => {
  const a = authFixture(), b = authFixture(a.backend), body = await pending(a);
  assert.equal(b.allCookies().size, 0);
  assert.equal((await b.post("auth/verify-otp", body)).status, 401);
  await b.post("auth/google", { mode: "begin" });
  assert.notEqual(a.browserCookies.get("ps_browser_auth"), b.browserCookies.get("ps_browser_auth"));
  assert.equal((await b.post("auth/verify-otp", body)).status, 401);
  assert.equal(b.cookies.size, 0); assert.equal(a.otps.length, 1);
  assert.equal((await a.post("auth/verify-otp", body)).status, 200);
  assert.equal((await identity(a)).userId, "student");
  assert.equal((await a.post("auth/verify-otp", body)).status, 401);
  const options = a.browserCookieOptions.get("ps_browser_auth")!;
  assert.equal(options.httpOnly, true); assert.equal(options.secure, true); assert.equal(options.sameSite, "lax");
});

test("same JWT second reauthentication changes generation and rejects sequential old OTP", async () => {
  const f = authFixture(), now = Date.now(), original = Date.now;
  Date.now = () => now;
  try {
    await password(f, "student"); const body = await pending(f);
    const before = f.auth.verifyToken(f.cookies.get("ps_session_user"));
    await password(f, "student"); const after = f.auth.verifyToken(f.cookies.get("ps_session_user"));
    assert.equal(before.iat, after.iat); assert.notEqual(before.authGeneration, after.authGeneration);
    const cookies = f.allCookies();
    assert.equal((await f.post("auth/verify-otp", body)).status, 401);
    assert.deepEqual(f.allCookies(), cookies); assert.equal((await identity(f)).authGeneration, after.authGeneration);
  } finally { Date.now = original; }
});

test("compare-and-advance is single-winner, and missing Redis state cannot resurrect an old generation", async () => {
  const f = authFixture(), helper = f.load("src/lib/browser-auth.ts");
  const binding = await helper.ensureBrowserAuthentication();
  const results = await Promise.allSettled([helper.advanceBrowserAuthentication(binding), helper.advanceBrowserAuthentication(binding)]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(results.filter(r => r.status === "rejected").length, 1);
  f.generations.values.clear();
  await assert.rejects(helper.advanceBrowserAuthentication(binding), /Authentication changed/);
  const recreated = await helper.ensureBrowserAuthentication();
  assert.notEqual(recreated.authGeneration, binding.authGeneration);
});

test("old tokens without browser generation require reauthentication", async () => {
  const f = authFixture();
  f.cookies.set("ps_session_user", jwt.sign({ userId: "student", role: "student", sessionVersion: 0,
    sessionClass: "user" }, f.environment.NEXTAUTH_SECRET, { audience: "proctorshield:user", expiresIn: "7d" }));
  assert.equal(await identity(f), null);
  await password(f, "student"); assert.equal((await identity(f)).userId, "student");
});

test("Redis outage never uses a local fallback or authorizes a stale token", async () => {
  const f = authFixture(); await password(f, "teacher"); const before = f.allCookies();
  f.generations.fail();
  await assert.rejects(identity(f), /Browser authentication state unavailable/);
  assert.equal((await f.post("auth/login", { email: "admin@example.test", password: "FixturePassword123" })).status, 503);
  assert.deepEqual(f.allCookies(), before);
  assert.equal((await f.post("auth/logout")).status, 503); assert.deepEqual(f.allCookies(), before);
  f.generations.recover();
  assert.equal((await f.post("auth/logout")).status, 200);
});

test("in-flight logout cannot invalidate a later successful authentication generation", async () => {
  const f = authFixture(); await password(f, "teacher");
  const helper = f.load("src/lib/browser-auth.ts"), original = helper.invalidateBrowserAuthentication;
  let reached!: () => void, resume!: () => void;
  const paused = new Promise<void>(resolve => { reached = resolve; }), gate = new Promise<void>(resolve => { resume = resolve; });
  helper.invalidateBrowserAuthentication = async (...args: unknown[]) => { reached(); await gate; return original(...args); };
  const logout = f.deferredPost("auth/logout"); await paused;
  try {
    assert.equal(f.users.get("teacher")!.sessionVersion, 1);
    await password(f, "student"); const current = await identity(f), token = f.cookies.get("ps_session_user")!;
    resume(); const old = await logout; assert.equal(old.response.status, 200);
    old.apply(); assert.equal(f.cookies.get("ps_session_user"), token);
    assert.deepEqual(old.response.headers.getSetCookie(), []);
    assert.equal((await identity(f)).authGeneration, current.authGeneration);
  } finally { resume(); }
});

for (const route of ["users/me", "auth/profile"]) test(`delayed ${route} profile refresh cannot adopt a newer login generation`, async () => {
  const f = authFixture(); await password(f, "student");
  const original = f.auth.prepareSessionToken;
  let reached!: () => void, resume!: () => void;
  const paused = new Promise<void>(resolve => { reached = resolve; }), gate = new Promise<void>(resolve => { resume = resolve; });
  f.auth.prepareSessionToken = async (...args: unknown[]) => { const token = await original(...args); reached(); await gate; return token; };
  const old = f.load(`src/app/api/${route}/route.ts`).PUT(new Request(`${f.environment.NEXT_PUBLIC_APP_URL}/api/${route}`, {
    method: "PUT", headers: { Origin: f.environment.NEXT_PUBLIC_APP_URL, "Content-Type": "application/json" }, body: JSON.stringify({ fullName: "Saved student" }),
  }));
  await paused;
  try { await password(f, "teacher"); resume(); assert.equal((await old).status, 401); assert.equal((await identity(f)).userId, "teacher"); }
  finally { resume(); }
});


for (const role of ["teacher", "admin"]) test(`cookie-less Student/${role} requests bootstrap without authenticating`, async () => {
  const f = authFixture();
  const old = await f.deferredPost("auth/login", { email: "student@example.test", password: "FixturePassword123" });
  const newer = await f.deferredPost("auth/login", { email: role + "@example.test", password: "FixturePassword123" });
  for (const result of [old, newer]) {
    assert.equal(result.response.status, 409);
    assert.equal((await result.response.clone().json()).code, "BROWSER_AUTH_INITIALIZED");
  }
  assert.equal(f.cookies.size, 0); assert.equal(f.browserCookies.size, 0);
  assert.equal(f.users.get("student")!.isOnline, false);
  old.apply(); const firstId = f.browserCookies.get("ps_browser_auth");
  newer.apply(); const establishedId = f.browserCookies.get("ps_browser_auth");
  assert.notEqual(firstId, establishedId);
  await password(f, role); const token = f.cookies.get(role === "admin" ? "ps_session_admin" : "ps_session_user");
  assert.equal((await identity(f)).role, role);
  assert.equal(f.browserCookies.get("ps_browser_auth"), establishedId);
  // A very late cookie-less initialization can force reauthentication, but it
  // has no session to restore. Restoring B's ID demonstrates B was not revoked.
  old.apply(); assert.equal(await identity(f), null);
  assert.equal(f.auth.verifyToken(token).role, role);
  f.browserCookies.set("ps_browser_auth", establishedId!);
  assert.equal((await identity(f)).role, role);
});

test("authentication on an established older ID never rewrites browser identity", async () => {
  const f = authFixture();
  const a = await f.deferredPost("auth/google", { mode: "begin" });
  const b = await f.deferredPost("auth/google", { mode: "begin" });
  a.apply(); const idA = f.browserCookies.get("ps_browser_auth");
  const pause = pauseOldIssuance(f);
  const old = f.deferredPost("auth/login", { email: "student@example.test", password: "FixturePassword123" }); await pause.paused;
  b.apply(); const idB = f.browserCookies.get("ps_browser_auth"); await password(f, "teacher");
  pause.resume(); const result = await old; result.apply();
  assert.notEqual(idA, idB); assert.equal(f.browserCookies.get("ps_browser_auth"), idB);
  assert.equal(await identity(f), null); // Old A JWT cannot authorize browser B.
});

for (const route of ["auth/login", "auth/google", "auth/register", "auth/verify-otp"]) test(`${route} initialization has no account/session side effects`, async () => {
  const f = authFixture(), before = structuredClone(f.users);
  const body = route === "auth/login" ? { email: "student@example.test", password: "FixturePassword123" }
    : route === "auth/google" ? { mode: "begin" }
    : route === "auth/register" ? { fullName: "New Person", email: "new@example.test", password: "FixturePassword123", role: "student" }
    : { userId: "student", otpCode: "123456" };
  const initial = await f.deferredPost(route, body);
  assert.equal(initial.response.status, 409); initial.apply();
  assert.deepEqual(f.users, before); assert.equal(f.cookies.size, 0);
  assert.equal(f.otps.length, 0); assert.equal(f.mail.length, 0);
  assert.equal(f.browserCookies.size, 1);
});

test("Redis initialize, CAS and repeated login preserve one absolute deadline", async () => {
  const f = authFixture(), helper = f.load("src/lib/browser-auth.ts");
  const originalNow = Date.now, start = Math.floor(Date.now() / 1000) * 1000;
  Date.now = () => start;
  try {
    const binding = await helper.ensureBrowserAuthentication(), key = "proctorshield:browser-auth:" + binding.browserId;
    assert.equal(f.generations.ttl(key), helper.BROWSER_AUTH_LIFETIME * 1000);
    assert.equal((f.browserCookieOptions.get("ps_browser_auth")!.expires as Date).getTime(), binding.expiresAt * 1000);
    Date.now = () => start + 86400000;
    const advanced = await helper.advanceBrowserAuthentication(binding);
    assert.equal(advanced.expiresAt, binding.expiresAt);
    assert.equal(f.generations.ttl(key), (helper.BROWSER_AUTH_LIFETIME - 86400) * 1000);
    const ttl = f.generations.ttl(key);
    await assert.rejects(helper.advanceBrowserAuthentication(binding), /Authentication changed/);
    assert.equal(f.generations.ttl(key), ttl);
    await password(f, "teacher"); await password(f, "student");
    assert.equal(f.generations.ttl(key), ttl);
    Date.now = () => binding.expiresAt * 1000;
    assert.equal(await helper.readBrowserAuthentication(), null); assert.equal(f.generations.ttl(key), -2);
    await assert.rejects(helper.advanceBrowserAuthentication(advanced), /Authentication changed/);
    const fresh = await helper.ensureBrowserAuthentication();
    assert.notEqual(fresh.browserId, binding.browserId); assert.notEqual(fresh.authGeneration, binding.authGeneration);
  } finally { Date.now = originalNow; }
});

test("day-29 login caps JWT/session cookie at the absolute browser expiry", async () => {
  const f = authFixture(), helper = f.load("src/lib/browser-auth.ts");
  const originalNow = Date.now, start = Math.floor(Date.now() / 1000) * 1000;
  Date.now = () => start;
  try {
    const binding = await helper.ensureBrowserAuthentication();
    Date.now = () => start + 29 * 86400000;
    await password(f, "admin"); const token = f.cookies.get("ps_session_admin")!;
    assert.equal((jwt.decode(token) as jwt.JwtPayload).exp, binding.expiresAt);
    assert.equal(f.cookieOptions.get("ps_session_admin")!.maxAge, 86400);
    Date.now = () => binding.expiresAt * 1000 - 1000;
    assert.equal((await identity(f)).role, "admin");
    Date.now = () => binding.expiresAt * 1000;
    assert.equal(f.auth.verifyToken(token), null); assert.equal(await identity(f), null);
  } finally { Date.now = originalNow; }
});

for (const route of ["users/me", "auth/profile"]) test(`${route} refresh caps expiry with two browser-auth days remaining`, async () => {
  const f = authFixture(); const originalNow = Date.now, start = Math.floor(Date.now() / 1000) * 1000;
  Date.now = () => start;
  try {
    await password(f, "student");
    const helper = f.load("src/lib/browser-auth.ts"), original = await helper.readBrowserAuthentication();
    // Keep the login current through day 28 via ordinary seven-day sessions.
    for (const day of [6, 12, 18, 24, 28]) { Date.now = () => start + day * 86400000; await password(f, "student"); }
    const before = await helper.readBrowserAuthentication();
    const response = await f.load("src/app/api/" + route + "/route.ts").PUT(new Request("https://app.example.test/api/" + route + "?scope=user&role=student", {
      method: "PUT", headers: { Origin: "https://app.example.test", "Content-Type": "application/json" }, body: JSON.stringify({ fullName: "Renewed name" }),
    }));
    assert.equal(response.status, 200);
    const claims = jwt.decode(f.cookies.get("ps_session_user")!) as jwt.JwtPayload;
    assert.equal(claims.exp, original.expiresAt); assert.equal(claims.authGeneration, before.authGeneration);
    assert.equal(f.generations.ttl("proctorshield:browser-auth:" + before.browserId), 2 * 86400000);
    Date.now = () => original.expiresAt * 1000;
    assert.equal(await identity(f), null);
  } finally { Date.now = originalNow; }
});

test("authentication has no Redis read after CAS", async () => {
  const f = authFixture(); await password(f, "teacher");
  const original = f.generations.client.eval; let committed = false, postCommitReads = 0;
  f.generations.client.eval = async (...args: Parameters<typeof original>) => {
    if (committed && args[0].startsWith("-- browser-auth:read")) { postCommitReads++; throw new Error("Prior post-CAS outage"); }
    const result = await original(...args);
    if (args[0].startsWith("-- browser-auth:advance") && result === 1) committed = true;
    return result;
  };
  try { await password(f, "student"); assert.equal(postCommitReads, 0); }
  finally { f.generations.client.eval = original; }
  assert.equal((await identity(f)).role, "student");
});

for (const failure of ["signing", "Redis read", "DB check"]) test(`${failure} failure before CAS preserves the prior session`, async () => {
  const f = authFixture(); await password(f, "teacher"); const before = f.allCookies(), generation = (await identity(f)).authGeneration;
  const secret = f.environment.NEXTAUTH_SECRET;
  if (failure === "signing") f.environment.NEXTAUTH_SECRET = "bad";
  if (failure === "Redis read") f.generations.fail();
  if (failure === "DB check") f.beforeUpdate(() => { f.users.get("student")!.status = "suspended"; });
  const response = await f.post("auth/login", { email: "student@example.test", password: "FixturePassword123" });
  assert.notEqual(response.status, 200); assert.deepEqual(f.allCookies(), before);
  f.environment.NEXTAUTH_SECRET = secret; f.generations.recover();
  assert.equal((await identity(f)).authGeneration, generation);
});

for (const [older, newer] of [["teacher", "student"], ["student", "teacher"], ["teacher", "admin"], ["admin", "student"], ["student", "student"]]) {
  test(`old ${older} logout paused before validation preserves newer ${newer} and its cookies`, async () => {
    const f = authFixture(); await password(f, older);
    const original = f.auth.getSession; let reached!: () => void, resume!: () => void;
    const paused = new Promise<void>(r => { reached = r; }), gate = new Promise<void>(r => { resume = r; });
    f.auth.getSession = async (...args: unknown[]) => { reached(); await gate; return original(...args); };
    const old = f.deferredPost("auth/logout"); await paused;
    await password(f, newer); const before = f.allCookies();
    resume(); const response = await old; response.apply(); f.auth.getSession = original;
    assert.equal(response.response.status, 200); assert.deepEqual(response.response.headers.getSetCookie(), []);
    assert.deepEqual(f.allCookies(), before); assert.equal((await identity(f)).role, newer);
    assert.equal(f.users.get(older)!.sessionVersion, 0);
  });
}

test("committed logout response delivered after newer login cannot erase its cookies", async () => {
  const f = authFixture(); await password(f, "teacher");
  const old = await f.deferredPost("auth/logout"); assert.equal(old.response.status, 200);
  assert.equal(f.users.get("teacher")!.sessionVersion, 1);
  await password(f, "student"); const before = f.allCookies();
  old.apply(); assert.deepEqual(f.allCookies(), before); assert.equal((await identity(f)).role, "student");
});

test("sessionless logout cannot invalidate a later login or anonymous OTP", async () => {
  const f = authFixture(), body = await pending(f);
  const old = await f.deferredPost("auth/logout"); assert.equal(old.response.status, 200);
  assert.equal((await f.post("auth/verify-otp", body)).status, 200);
  const before = f.allCookies(); old.apply(); assert.deepEqual(f.allCookies(), before);
  assert.equal((await identity(f)).role, "student");
});


test("response serialization failure before CAS preserves the current Teacher", async () => {
  const f = authFixture(); await password(f, "teacher"); const before = f.allCookies(), generation = (await identity(f)).authGeneration;
  const original = Response.json;
  Response.json = (body: unknown, init?: ResponseInit) => {
    if ((body as { user?: { role?: string } })?.user?.role === "student") throw new Error("Injected serialization failure");
    return original(body, init);
  };
  try { assert.equal((await f.post("auth/login", { email: "student@example.test", password: "FixturePassword123" })).status, 500); }
  finally { Response.json = original; }
  assert.deepEqual(f.allCookies(), before); assert.equal((await identity(f)).authGeneration, generation);
});

test("post-CAS scheduling failure cannot turn committed authentication into failure", async () => {
  const f = authFixture(); await password(f, "teacher"); f.failAfter();
  await password(f, "student"); assert.equal((await identity(f)).role, "student");
});
