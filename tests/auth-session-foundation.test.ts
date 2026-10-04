import assert from "node:assert/strict";
import test from "node:test";
import jwt from "jsonwebtoken";
import { authFixture } from "./helpers/auth-fixture.ts";

for (const [role, cookie, reader, valid] of [
  ["admin", "ps_session_admin", "getAdminSession", true],
  ["teacher", "ps_session_user", "getUserSession", true],
  ["student", "ps_session_user", "getUserSession", true],
  ["admin", "ps_session_user", "getUserSession", false],
  ["teacher", "ps_session_admin", "getAdminSession", false],
  ["student", "ps_session_admin", "getAdminSession", false],
] as const) test(`${role} token in ${cookie}: strict ${reader} ${valid ? "accepts" : "rejects"}`, async () => {
  const f = authFixture(); f.cookies.set(cookie, f.token(role));
  const result = await f.auth[reader]();
  assert.equal(result?.role ?? null, valid ? role : null);
});

for (const changed of ["role", "suspended", "inactive", "version", "deleted"] as const) {
  test(`DB ${changed} invalidates a correctly signed Admin token`, async () => {
    const f = authFixture(); f.cookies.set("ps_session_admin", f.token("admin"));
    const u = f.users.get("admin")!;
    if (changed === "role") u.role.roleName = "teacher";
    if (changed === "suspended" || changed === "inactive") u.status = changed;
    if (changed === "version") u.sessionVersion++;
    if (changed === "deleted") f.users.delete("admin");
    assert.equal(await f.auth.getAdminSession(), null);
  });
}

test("signed class/audience mismatches and legacy tokens are rejected", async () => {
  const f = authFixture();
  const payload = { userId: "admin", role: "admin", sessionVersion: 0 };
  for (const extra of [{}, { sessionClass: "user", aud: "proctorshield:user" }, { sessionClass: "admin", aud: "proctorshield:user" }]) {
    f.cookies.set("ps_session_admin", jwt.sign({ ...payload, ...extra }, f.environment.NEXTAUTH_SECRET));
    assert.equal(await f.auth.getAdminSession(), null);
  }
});

test("both current cookies deny mixed identity; explicit readers never fall back", async () => {
  const f = authFixture(); f.cookies.set("ps_session_admin", f.token("admin")); f.cookies.set("ps_session_user", f.token("teacher"));
  assert.equal(await f.auth.getSession(), null);
  assert.equal((await f.auth.getAdminSession()).role, "admin");
  assert.equal((await f.auth.getUserSession()).role, "teacher");
  f.cookies.delete("ps_session_admin"); assert.equal(await f.auth.getAdminSession(), null);
  assert.equal(await f.auth.getSession("admin"), null);
  assert.equal(await f.auth.getUserSession("student"), null);
});

for (const legacy of ["ps_session_teacher", "ps_session_student"]) test(`${legacy} cannot supply or change either strict identity`, async () => {
  const f = authFixture(); f.cookies.set(legacy, f.token("teacher"));
  assert.equal(await f.auth.getSession(), null); assert.equal(await f.auth.getUserSession(), null); assert.equal(await f.auth.getAdminSession(), null);
  f.cookies.set("ps_session_admin", f.token("admin")); assert.equal((await f.auth.getSession()).role, "admin");
  f.cookies.delete("ps_session_admin"); f.cookies.set("ps_session_user", f.token("student")); assert.equal((await f.auth.getSession()).role, "student");
});

for (const role of ["admin", "teacher", "student"]) test(`${role} password login sets only its class cookie and clears legacy/opposite cookies`, async () => {
  const f = authFixture();
  for (const cookie of ["ps_session_admin", "ps_session_user", "ps_session_teacher", "ps_session_student"]) f.cookies.set(cookie, "old");
  const response = await f.post("auth/login", { email: `${role}@example.test`, password: "FixturePassword123", role });
  assert.equal(response.status, 200);
  const name = role === "admin" ? "ps_session_admin" : "ps_session_user";
  assert.deepEqual([...f.cookies.keys()], [name]);
  const claims = f.auth.verifyToken(f.cookies.get(name));
  assert.equal(claims.sessionClass, role === "admin" ? "admin" : "user");
  assert.equal(claims.aud, `proctorshield:${claims.sessionClass}`);
  assert.equal(claims.password, undefined);
  assert.equal(f.cookieOptions.get(name)?.httpOnly, true); assert.equal(f.cookieOptions.get(name)?.secure, true);
  assert.equal(f.cookieOptions.get(name)?.sameSite, "lax");
  assert.equal((await response.json()).token, undefined);
});

for (const role of ["teacher", "student"]) test(`${role} credentials cannot request Admin privileges`, async () => {
  const f = authFixture();
  assert.equal((await f.post("auth/login", { email: `${role}@example.test`, password: "FixturePassword123", role: "admin" })).status, 403);
  assert.equal(f.cookies.size, 0);
});

for (const changed of ["reset", "password", "role", "status", "delete"]) test(`${changed} between password verification and issuance rejects stale authentication`, async () => {
  const f = authFixture();
  f.beforeUpdate(() => {
    const u = f.users.get("teacher")!;
    if (changed === "reset") { u.password = "replacement-hash"; u.sessionVersion++; }
    if (changed === "password") u.password = "replacement-hash";
    if (changed === "role") u.role.roleName = "admin";
    if (changed === "status") u.status = "suspended";
    if (changed === "delete") f.users.delete("teacher");
  });
  assert.equal((await f.post("auth/login", { email: "teacher@example.test", password: "FixturePassword123" })).status, 401);
  assert.equal(f.cookies.size, 0);
});

test("unrelated issuance DB failures propagate instead of authenticating", async () => {
  const f = authFixture(); f.beforeUpdate(() => { throw Object.assign(new Error("Unavailable DB"), { code: "P2002" }); });
  assert.equal((await f.post("auth/login", { email: "teacher@example.test", password: "FixturePassword123" })).status, 500);
  assert.equal(f.cookies.size, 0);
});

test("account-wide logout revokes copied JWT, retains revoked cookies safely, and audits once", async () => {
  const f = authFixture(), token = f.token("teacher"); f.cookies.set("ps_session_user", token);
  f.cookies.set("ps_session_teacher", "legacy"); f.cookies.set("ps_session_student", "legacy");
  const response = await f.post("auth/logout", { role: "admin" });
  assert.equal(response.status, 200); assert.equal((await response.json()).redirectTo, "/login");
  assert.equal(f.users.get("teacher")!.sessionVersion, 1); assert.equal(await f.auth.getSession(undefined, { touchActivity: false }), null); assert.equal(f.logs.length, 1);
  f.cookies.set("ps_session_user", token); assert.equal(await f.auth.getUserSession(), null);
  assert.equal((await f.post("auth/logout")).status, 200); assert.equal(f.users.get("teacher")!.sessionVersion, 1);
});

test("logout audit failure rolls back revocation, invalidates browser generation, reports failure", async () => {
  const f = authFixture(); f.cookies.set("ps_session_admin", f.token("admin")); f.failAudit();
  assert.equal((await f.post("auth/logout")).status, 503);
  assert.equal(f.users.get("admin")!.sessionVersion, 0); assert.equal(f.logs.length, 0); assert.equal(await f.auth.getSession(undefined, { touchActivity: false }), null);
});

test("conflicting logout preserves cookies without claiming arbitrary account revocation", async () => {
  const f = authFixture(); f.cookies.set("ps_session_admin", f.token("admin")); f.cookies.set("ps_session_user", f.token("teacher"));
  assert.equal((await f.post("auth/logout")).status, 409); assert.equal(await f.auth.getSession(undefined, { touchActivity: false }), null);
  assert.equal(f.users.get("admin")!.sessionVersion, 0); assert.equal(f.users.get("teacher")!.sessionVersion, 0);
});

for (const role of ["teacher", "student"]) test(`Google ${role} uses persisted role regardless of portal hint and creates session only after OTP`, async () => {
  const f = authFixture(); f.googleIdentity(role);
  const response = await f.post("auth/google", { credential: "verified-fixture", role: role === "teacher" ? "student" : "teacher" });
  assert.equal(response.status, 200); const body = await response.json();
  assert.equal(body.role, role); assert.equal(body.requiresMfa, true); assert.equal(f.cookies.size, 0);
  assert.deepEqual(f.mail, [`${role}@example.test`]);
  assert.equal((await f.post("auth/verify-otp", { userId: role, otpCode: "123456" })).status, 200);
  assert.equal((await f.auth.getUserSession()).role, role);
  assert.equal((await f.post("auth/verify-otp", { userId: role, otpCode: "123456" })).status, 401);
});

test("Admin Google identity and pre-existing Admin OTP cannot issue Admin session", async () => {
  const f = authFixture(); f.googleIdentity("admin");
  for (const role of ["teacher", "student", "admin"]) {
    assert.ok([400, 403].includes((await f.post("auth/google", { credential: "verified-fixture", role })).status));
  }
  f.otps.push({ id: 1, userId: "admin", code: "login:admin:123456", expiresAt: new Date(Date.now() + 60_000) });
  assert.equal((await f.post("auth/verify-otp", { userId: "admin", otpCode: "123456" })).status, 403);
  assert.equal(f.cookies.size, 0); assert.equal(f.mail.length, 0);
});

test("account changes during OTP consumption cannot issue a stale session", async () => {
  const f = authFixture(); f.otps.push({ id: 1, userId: "teacher", code: "login:teacher:123456", expiresAt: new Date(Date.now() + 60_000) });
  f.beforeUpdate(() => { f.users.get("teacher")!.sessionVersion++; });
  assert.equal((await f.post("auth/verify-otp", { userId: "teacher", otpCode: "123456" })).status, 401);
  assert.equal(f.cookies.size, 0);
});

for (const route of ["auth/login", "auth/logout", "auth/google", "auth/verify-otp", "auth/register"]) {
  test(`${route} rejects missing/foreign/null Origin before writes`, async () => {
    const f = authFixture();
    for (const origin of [null, "https://evil.example.test", "null"]) assert.equal((await f.post(route, {}, origin)).status, 403);
    assert.equal(f.logs.length, 0); assert.equal(f.cookies.size, 0); assert.equal(f.mail.length, 0);
  });
}

test("Origin guard rejects cross-site context and forged forwarded host", () => {
  const f = authFixture(), guard = f.load("src/lib/auth-origin.ts").isTrustedAuthOrigin;
  assert.equal(guard(new Request("https://internal.test", { headers: { Origin: "https://app.example.test" } })), true);
  assert.equal(guard(new Request("https://app.example.test", { headers: { Origin: "https://evil.test", "x-forwarded-host": "evil.test" } })), false);
  assert.equal(guard(new Request("https://app.example.test", { headers: { Origin: "https://app.example.test", "sec-fetch-site": "cross-site" } })), false);
});

test("Admin-scoped session/notifications reject a User cookie instead of returning User data", async () => {
  const f = authFixture(); f.cookies.set("ps_session_user", f.token("teacher"));
  for (const route of ["auth/session", "notifications"]) {
    const response = await f.load(`src/app/api/${route}/route.ts`).GET(new Request(`https://app.example.test/api/${route}?scope=admin`));
    assert.equal(response.status, 401);
  }
});

test("actual Admin dashboard guard denies a correctly signed User session", async () => {
  const f = authFixture(); f.cookies.set("ps_session_user", f.token("teacher"));
  const response = await f.load("src/app/api/dashboard/admin/route.ts").GET(new Request("https://app.example.test/api/dashboard/admin"));
  assert.equal(response.status, 401);
});

test("DB session-validation outage is 503, not permanent Admin authorization loss", async () => {
  const f = authFixture(); f.cookies.set("ps_session_admin", f.token("admin")); f.failRead();
  const response = await f.load("src/app/api/auth/session/route.ts").GET(new Request("https://app.example.test/api/auth/session?scope=admin"));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).user, null);
});

test("Admin-scoped profile update cannot target a replacement Teacher session", async () => {
  const f = authFixture(); f.cookies.set("ps_session_user", f.token("teacher"));
  const response = await f.load("src/app/api/auth/profile/route.ts").PUT(new Request("https://app.example.test/api/auth/profile?scope=admin", {
    method: "PUT", headers: { Origin: "https://app.example.test", "Content-Type": "application/json" }, body: JSON.stringify({ fullName: "Wrong account" }),
  }));
  assert.equal(response.status, 401); assert.equal(f.users.get("teacher")!.fullName, "teacher");
});

test("actual Pusher authorization rejects User Admin-channel access and retains per-user identity", async () => {
  const f = authFixture(), route = f.load("src/app/api/pusher/auth/route.ts");
  const authorize = (channel: string) => route.POST(new Request("https://app.example.test/api/pusher/auth", {
    method: "POST", body: new URLSearchParams({ socket_id: "1.2", channel_name: channel }),
  }));
  f.cookies.set("ps_session_user", f.token("teacher"));
  assert.equal((await authorize("private-admin-dashboard")).status, 401);
  assert.equal((await authorize("private-teacher-teacher")).status, 200);
  assert.equal((await authorize("private-teacher-other")).status, 403);
  assert.equal((await authorize("private-user-admin")).status, 403);
  f.cookies.clear(); f.cookies.set("ps_session_admin", f.token("admin"));
  assert.equal((await authorize("private-admin-dashboard")).status, 200);
  assert.equal((await authorize("private-teacher-teacher")).status, 401);
  assert.deepEqual(f.events, ["private-teacher-teacher", "private-admin-dashboard"]);
});
