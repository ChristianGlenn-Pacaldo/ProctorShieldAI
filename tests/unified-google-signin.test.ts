import assert from "node:assert/strict";
import test from "node:test";
import jwt from "jsonwebtoken";
import { authFixture } from "./helpers/auth-fixture.ts";
import { getAuthDestination } from "../src/lib/auth-destination.ts";

type Fixture = ReturnType<typeof authFixture>;
async function begin(f: Fixture) {
  const response = await f.post("auth/google", { mode: "begin" });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  const intent = await response.json();
  f.googleNonce(intent.nonce);
  return intent.intent as string;
}
async function google(f: Fixture, role = "student", intent?: string) {
  f.googleIdentity(role);
  return f.post("auth/google", { mode: "signin", credential: "verified-fixture", intent: intent ?? await begin(f), role: "admin" });
}
async function pending(f: Fixture, role = "student") {
  const response = await google(f, role);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.requiresMfa, true);
  return { userId: data.userId, challenge: data.challenge, otpCode: "123456" };
}
function state(f: Fixture) {
  return { users: structuredClone(f.users), cookies: [...f.cookies], options: [...f.cookieOptions], logs: [...f.logs], events: [...f.events] };
}

for (const role of ["student", "teacher"] as const) {
  test(`unified existing ${role} follows DB role despite Admin hint, preserves formal name, and issues only User session after OTP`, async () => {
    const f = authFixture();
    const name = "SAVED, FORMAL, NAME"; f.users.get(role)!.fullName = name;
    const before = state(f);
    const body = await pending(f, role);
    assert.deepEqual(state(f), before);
    assert.deepEqual(f.mail, [`${role}@example.test`]);
    assert.notEqual(f.otps[0].code, body.otpCode);
    assert.doesNotMatch(body.challenge, /FixturePassword|SAVED|example.test/);
    const verified = await f.post("auth/verify-otp", body);
    assert.equal(verified.status, 200);
    const result = await verified.json();
    assert.equal(result.user.fullName, name);
    assert.equal(getAuthDestination(result.user.role), `/dashboard/${role}`);
    assert.deepEqual([...f.cookies.keys()], ["ps_session_user"]);
    assert.equal((await f.auth.getUserSession(role)).fullName, name);
    const cookie = f.cookies.get("ps_session_user");
    assert.equal((await f.post("auth/verify-otp", body)).status, 401);
    assert.equal(f.cookies.get("ps_session_user"), cookie);
  });
}

for (const role of ["admin", "new-student", "new-teacher"]) {
  test(`unified ${role} identity is rejected without registration, email, session, or account mutation`, async () => {
    const f = authFixture(), before = state(f);
    const response = await google(f, role);
    assert.equal(response.status, role === "admin" ? 403 : 404);
    if (role !== "admin") assert.equal((await response.json()).code, "ACCOUNT_NOT_FOUND");
    assert.deepEqual(state(f), before); assert.equal(f.mail.length, 0); assert.equal(f.otps.length, 0);
  });
}

for (const cookieRole of ["anonymous", "student", "teacher", "admin", "mixed"]) {
  test(`beginning Google with ${cookieRole} browser identity never clears cookies, revokes sessions, or touches activity`, async () => {
    const f = authFixture();
    if (cookieRole !== "anonymous") f.cookies.set(cookieRole === "admin" ? "ps_session_admin" : "ps_session_user", f.token(cookieRole === "mixed" ? "student" : cookieRole));
    if (cookieRole === "mixed") f.cookies.set("ps_session_admin", f.token("admin"));
    for (const user of f.users.values()) user.lastSeenAt = new Date(0);
    const before = state(f); await begin(f); assert.deepEqual(state(f), before);
    assert.equal(f.mail.length, 0); assert.equal(f.otps.length, 0);
  });
}

for (const kind of ["wrong", "expired", "consumed", "wrong-purpose", "missing-challenge", "tampered-challenge", "wrong-user", "intent-as-challenge"]) {
  test(`unified OTP rejects ${kind} without session issuance`, async () => {
    const f = authFixture(), body = await pending(f);
    if (kind === "wrong") body.otpCode = "654321";
    if (kind === "expired") f.otps[0].expiresAt = new Date(0);
    if (kind === "consumed") f.otps.splice(0);
    if (kind === "wrong-purpose") f.otps[0].code = "password-reset:student:123456";
    if (kind === "missing-challenge") body.challenge = undefined;
    if (kind === "tampered-challenge") body.challenge += "x";
    if (kind === "wrong-user") body.userId = "teacher";
    if (kind === "intent-as-challenge") body.challenge = await begin(f);
    assert.equal((await f.post("auth/verify-otp", body)).status, 401);
    assert.equal(f.cookies.size, 0); assert.equal(f.users.get("student")!.isOnline, false);
  });
}

test("expired signed challenge cannot authorize a still-live OTP", async () => {
  const f = authFixture(), body = await pending(f);
  body.challenge = jwt.sign({ ...(jwt.decode(body.challenge) as jwt.JwtPayload), exp: 1 }, f.environment.NEXTAUTH_SECRET);
  assert.equal((await f.post("auth/verify-otp", body)).status, 401); assert.equal(f.cookies.size, 0);
});

for (const kind of ["inactive", "suspended", "deleted", "teacher-role", "admin-role", "version", "password"] as const) {
  test(`account ${kind} change before unified OTP cannot mint stale authorization`, async () => {
    const f = authFixture(), body = await pending(f), user = f.users.get("student")!;
    if (kind === "inactive" || kind === "suspended") user.status = kind;
    if (kind === "deleted") f.users.delete("student");
    if (kind === "teacher-role" || kind === "admin-role") user.role.roleName = kind === "teacher-role" ? "teacher" : "admin";
    if (kind === "version") user.sessionVersion++;
    if (kind === "password") user.password = "changed-fixture-password-hash";
    const before = state(f);
    assert.ok([401, 403, 404].includes((await f.post("auth/verify-otp", body)).status));
    assert.deepEqual(state(f), before);
  });
}

for (const kind of ["role", "status", "version"] as const) {
  test(`conditional session issuance rejects ${kind} race after unified OTP account validation`, async () => {
    const f = authFixture(), body = await pending(f);
    f.beforeUpdate(() => {
      const user = f.users.get("student")!;
      if (kind === "role") user.role.roleName = "teacher";
      if (kind === "status") user.status = "inactive";
      if (kind === "version") user.sessionVersion++;
    });
    assert.equal((await f.post("auth/verify-otp", body)).status, 401); assert.equal(f.cookies.size, 0);
  });
}

for (const role of ["student", "teacher", "admin"]) {
  for (const step of ["Google callback", "OTP"] as const) {
    test(`new ${role} password identity before ${step} rejects the old Google flow and preserves the newer cookie`, async () => {
      const f = authFixture(), intent = await begin(f);
      const body = step === "OTP" ? await pending(f) : null;
      assert.equal((await f.post("auth/login", { email: `${role}@example.test`, password: "FixturePassword123" })).status, 200);
      const before = state(f);
      const response = body ? await f.post("auth/verify-otp", body) : await google(f, "student", intent);
      assert.equal(response.status, 401); assert.deepEqual(state(f), before);
    });
  }
}

test("account-wide revocation of the starting browser identity blocks delayed Google completion even with unchanged cookie bytes", async () => {
  const f = authFixture(); f.cookies.set("ps_session_user", f.token("teacher"));
  const body = await pending(f); f.users.get("teacher")!.sessionVersion++;
  const before = state(f);
  assert.equal((await f.post("auth/verify-otp", body)).status, 401); assert.deepEqual(state(f), before);
});

test("logout during pending Google OTP does not get undone by its old challenge", async () => {
  const f = authFixture(); f.cookies.set("ps_session_user", f.token("teacher"));
  const body = await pending(f); assert.equal((await f.post("auth/logout")).status, 200);
  const before = state(f);
  assert.equal((await f.post("auth/verify-otp", body)).status, 401); assert.deepEqual(state(f), before);
});

test("reissued OTP with identical fixture digits cannot reuse the older signed challenge", async () => {
  const f = authFixture(), old = await pending(f), fresh = await pending(f);
  assert.notEqual(old.challenge, fresh.challenge);
  assert.equal((await f.post("auth/verify-otp", old)).status, 401);
  assert.equal((await f.post("auth/verify-otp", fresh)).status, 200);
});

test("concurrent unified OTP completion atomically consumes only once", async () => {
  const f = authFixture(), body = await pending(f);
  const responses = await Promise.all([f.post("auth/verify-otp", body), f.post("auth/verify-otp", body)]);
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 401]); assert.equal(f.otps.length, 0);
});

test("Google nonce mismatch rejects a verified identity before emailing a challenge", async () => {
  const f = authFixture(), intent = await begin(f); f.googleNonce("other-flow");
  assert.equal((await google(f, "student", intent)).status, 401);
  assert.equal(f.mail.length, 0); assert.equal(f.cookies.size, 0);
});

for (const status of ["inactive", "suspended"]) test(`${status} existing account is rejected before OTP`, async () => {
  const f = authFixture(); f.users.get("student")!.status = status;
  assert.equal((await google(f)).status, 403); assert.equal(f.mail.length, 0); assert.equal(f.otps.length, 0);
});

test("unified mode requires intent and rejects unknown modes without falling back to registration", async () => {
  const f = authFixture(); f.googleIdentity("new-student");
  assert.equal((await f.post("auth/google", { mode: "signin", credential: "verified-fixture" })).status, 401);
  assert.equal((await f.post("auth/google", { mode: "signup", credential: "verified-fixture" })).status, 400);
  assert.equal(f.users.size, 3); assert.equal(f.cookies.size, 0);
});

test("legacy Admin challenge still cannot issue a User or Admin Google session", async () => {
  const f = authFixture(); f.otps.push({ id: 1, userId: "admin", code: "login:admin:123456", expiresAt: new Date(Date.now() + 60_000) });
  assert.equal((await f.post("auth/verify-otp", { userId: "admin", otpCode: "123456" })).status, 403);
  assert.equal(f.cookies.size, 0);
});

test("begin/signin remain same-origin protected", async () => {
  const f = authFixture();
  for (const mode of ["begin", "signin"]) for (const origin of [null, "https://evil.example.test"]) {
    assert.equal((await f.post("auth/google", { mode, credential: "verified-fixture" }, origin)).status, 403);
  }
  assert.equal(f.mail.length, 0); assert.equal(f.cookies.size, 0);
});
