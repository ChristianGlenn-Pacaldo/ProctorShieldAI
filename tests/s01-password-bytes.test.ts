import assert from "node:assert/strict";
import test from "node:test";
import bcrypt from "bcryptjs";
import { isStrongPassword } from "../src/lib/security.ts";
import { authFixture } from "./helpers/auth-fixture.ts";

const ascii72 = "A1" + "a".repeat(70);
const unicode72 = "A1" + "é".repeat(35);
const emoji72 = "A1" + "🙂".repeat(17) + "aa";
for (const [label, password, valid] of [
  ["ordinary", "OrdinaryPassword123", true], ["ASCII 71", ascii72.slice(0, 71), true],
  ["ASCII 72", ascii72, true], ["ASCII 73", ascii72 + "x", false],
  ["2-byte Unicode 72", unicode72, true], ["2-byte Unicode 74", unicode72 + "é", false],
  ["4-byte Unicode 72", emoji72, true], ["4-byte Unicode 76", emoji72 + "🙂", false],
  ["short", "Short1", false], ["no number", "a".repeat(20), false],
] as const) test(`new-password policy: ${label}`, () => {
  assert.equal(isStrongPassword(password), valid, `${Buffer.byteLength(password, "utf8")} UTF-8 bytes`);
});

test("new hashing rejects overlong input instead of silently truncating, and accepts boundary values", async () => {
  const f = authFixture();
  for (const p of [ascii72 + "x", unicode72 + "é", emoji72 + "🙂"]) {
    await assert.rejects(f.auth.hashPassword(p), /72.*UTF-8 bytes/);
  }
  for (const p of ["OrdinaryPassword123", ascii72, unicode72, emoji72]) {
    const hash = await f.auth.hashPassword(p);
    assert.match(hash, /^psai:pw:v1:\$2b\$12\$/);
    assert.equal(bcrypt.getRounds(hash.slice("psai:pw:v1:".length)), 12);
    assert.equal(await f.auth.verifyPassword(p + "x".repeat(73 - Buffer.byteLength(p, "utf8")), hash), false);
    assert.equal(await f.auth.verifyPassword(p, hash), true);
    assert.equal(await f.auth.verifyPassword("Wrong" + p.slice(5), hash), false);
  }
});

for (const role of ["student", "teacher"]) {
  test(`${role} registration rejects overlong passwords before account/session creation`, async () => {
    for (const password of [ascii72 + "x", unicode72 + "é"]) {
      const f = authFixture();
      const response = await f.post("auth/register", { role, email: "new@example.test", fullName: "New Person", password, confirmPassword: password });
      assert.equal(response.status, 400); assert.match((await response.json()).message, /72.*UTF-8 bytes/);
      assert.equal(f.users.size, 3); assert.equal(f.cookies.size, 0); assert.equal(f.logs.length, 0);
    }
  });
  test(`${role} registration accepts exactly 72 UTF-8 bytes with existing session behavior`, async () => {
    const f = authFixture();
    const response = await f.post("auth/register", { role, email: "new@example.test", fullName: "New Person", password: unicode72, confirmPassword: unicode72 });
    assert.equal(response.status, 201); assert.equal((await response.json()).user.role, role);
    assert.equal(await f.auth.verifyPassword(unicode72, f.users.get("new-user")!.password), true);
    assert.ok(f.cookies.has("ps_session_user")); assert.equal(f.cookies.has("ps_session_admin"), false);
    assert.equal(f.cookieOptions.get("ps_session_user")!.httpOnly, true);
  });
}

for (const role of ["student", "teacher", "admin"]) {
  test(`${role} reset validates bytes before consuming OTP and still accepts the boundary`, async () => {
    const f = authFixture(), user = f.users.get(role)!;
    const originalHash = user.password;
    f.otps.push({ id: 1, userId: role, code: `password-reset:${role}:123456`, expiresAt: new Date(Date.now() + 60_000) });
    const invalid = await f.post("auth/reset-password", { email: user.email, otpCode: "123456", newPassword: unicode72 + "é" });
    assert.equal(invalid.status, 400); assert.match((await invalid.json()).message, /72.*UTF-8 bytes/);
    assert.equal(user.password, originalHash); assert.equal(user.sessionVersion, 0); assert.equal(f.otps.length, 1); assert.equal(f.logs.length, 0);
    const valid = await f.post("auth/reset-password", { email: user.email, otpCode: "123456", newPassword: unicode72 });
    assert.equal(valid.status, 200); assert.equal(await f.auth.verifyPassword(unicode72, user.password), true);
    assert.equal(user.sessionVersion, 1); assert.equal(f.otps.length, 0); assert.equal(f.logs.length, 1); assert.equal(f.cookies.size, 0);
  });
  test(`${role} profile byte rejection has no write; legitimate change preserves session isolation`, async () => {
    const f = authFixture(), user = f.users.get(role)!;
    const cookie = role === "admin" ? "ps_session_admin" : "ps_session_user";
    const token = f.token(role); f.cookies.set(cookie, token);
    const originalHash = user.password;
    const put = (password: string) => f.load("src/app/api/auth/profile/route.ts").PUT(new Request(`https://app.example.test/api/auth/profile?scope=${role === "admin" ? "admin" : "user"}`, {
      method: "PUT", headers: { Origin: "https://app.example.test", "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: "FixturePassword123", newPassword: password }),
    }));
    const invalid = await put(emoji72 + "🙂"); assert.equal(invalid.status, 400); assert.match((await invalid.json()).message, /72.*UTF-8 bytes/);
    assert.equal(user.password, originalHash); assert.equal(user.sessionVersion, 0); assert.equal(f.logs.length, 0); assert.equal(f.cookies.get(cookie), token);
    assert.equal((await put(emoji72)).status, 200); assert.equal(await f.auth.verifyPassword(emoji72, user.password), true);
    assert.equal(user.sessionVersion, 1); assert.equal(f.cookies.size, 1); assert.ok(f.cookies.has(cookie));
    assert.equal(f.cookieOptions.get(cookie)!.httpOnly, true);
  });
  test(`${role} legacy overlong password still signs in without changing its hash`, async () => {
    const f = authFixture(), user = f.users.get(role)!;
    const legacy = ascii72 + "LegacySuffix"; user.password = bcrypt.hashSync(legacy, 4);
    const hash = user.password;
    const response = await f.post("auth/login", { email: user.email, password: legacy, role });
    assert.equal(response.status, 200); assert.equal((await response.json()).user.role, role);
    assert.equal(user.password, hash); assert.equal(user.sessionVersion, 0);
    assert.ok(f.cookies.has(role === "admin" ? "ps_session_admin" : "ps_session_user"));
    assert.equal(await f.auth.verifyPassword("Wrong" + legacy.slice(5), hash), false);
  });
}

test("legacy bcrypt suffix equivalence is documented, not silently migrated", async () => {
  const f = authFixture(); const legacyHash = bcrypt.hashSync(ascii72 + "OldSuffix", 4);
  assert.equal(await f.auth.verifyPassword(ascii72 + "OtherSuffix", legacyHash), true);
  assert.equal(isStrongPassword(ascii72 + "OldSuffix"), false);
});
