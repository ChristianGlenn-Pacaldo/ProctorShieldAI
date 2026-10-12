import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test, { before } from "node:test";
import ts from "typescript";
import bcrypt from "bcryptjs";
import { hashPassword, verifyPassword, isStrictPasswordInput, STRICT_PASSWORD_HASH_PREFIX, PASSWORD_HASH_COST } from "../src/lib/password-hash.ts";
import { isStrongPassword } from "../src/lib/security.ts";
import { authFixture } from "./helpers/auth-fixture.ts";

const p72 = "A1" + "a".repeat(70), p71 = p72.slice(0, 71);
let strict72: string, strict71: string;
before(async () => { strict72 = await hashPassword(p72); strict71 = await hashPassword(p71); });

function instrument(compare: typeof bcrypt.compare = bcrypt.compare) {
  const calls: string[] = [];
  const exports: { verifyPassword?: typeof verifyPassword; hashPassword?: typeof hashPassword } = {};
  const dependency = { ...bcrypt, compare: async (password: string, stored: string) => { calls.push("compare"); return compare(password, stored); },
    hash: async (password: string, cost: number) => { calls.push("hash"); return bcrypt.hash(password, cost); } };
  const code = ts.transpileModule(fs.readFileSync("src/lib/password-hash.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  vm.runInNewContext(code, { exports, Error, require: (name: string) => { assert.equal(name, "bcryptjs"); return dependency; } });
  return { calls, verify: exports.verifyPassword!, hash: exports.hashPassword! };
}

for (const [family, make] of [
  ["ASCII", (bytes: number) => "A1" + "a".repeat(bytes - 2)],
  ["Unicode", (bytes: number) => "A1" + "é".repeat(Math.floor((bytes - 2) / 2)) + "a".repeat((bytes - 2) % 2)],
  ["emoji", (bytes: number) => "A1" + "🙂".repeat(Math.floor((bytes - 2) / 4)) + "a".repeat((bytes - 2) % 4)],
] as const) for (const bytes of [71, 72, 73]) test(`${family} ${bytes} UTF-8 bytes: strict setting and comparison`, async () => {
  const password = make(bytes); assert.equal(Buffer.byteLength(password, "utf8"), bytes);
  assert.equal(isStrictPasswordInput(password), bytes <= 72); assert.equal(isStrongPassword(password), bytes <= 72);
  if (bytes === 73) { const probe = instrument(); await assert.rejects(probe.hash(password), /72.*UTF-8/); assert.equal(await probe.verify(password, strict72), false); assert.equal(probe.calls.length, 0); return; }
  const stored = await hashPassword(password); assert.equal(stored.length, 71); assert.ok(stored.startsWith(STRICT_PASSWORD_HASH_PREFIX));
  const payload = stored.slice(STRICT_PASSWORD_HASH_PREFIX.length); assert.equal(bcrypt.getRounds(payload), 12); assert.equal(PASSWORD_HASH_COST, 12);
  assert.equal(await verifyPassword(password, stored), true); assert.equal(await verifyPassword("Wrong" + password.slice(5), stored), false);
});

test("strict suffix and embedded/appended NUL rejection occurs before bcrypt", async () => {
  const probe = instrument();
  for (const password of [p72 + "x", p72 + "é", p72 + "\0", p71 + "\0", "A1\0" + "a".repeat(60)]) {
    assert.equal(await probe.verify(password, password === p71 + "\0" ? strict71 : strict72), false);
    assert.equal(isStrongPassword(password), false);
    await assert.rejects(probe.hash(password));
  }
  assert.equal(probe.calls.length, 0);
});

test("malformed, unknown and noncanonical hashes never reach bcrypt or permissive fallback", async () => {
  const probe = instrument(), payload = strict72.slice(STRICT_PASSWORD_HASH_PREFIX.length);
  const malformed: unknown[] = [null, undefined, {}, 42, "", strict72 + "\n", strict72 + "\r", " " + strict72, strict72 + " ", strict72.slice(0, -1),
    strict72.replace("v1:", "v2:"), strict72.replace("psai", "PSAI"), STRICT_PASSWORD_HASH_PREFIX + strict72,
    strict72.replace("$2b$", "$2a$"), strict72.replace("$12$", "$04$"), strict72.replace("$12$", "$31$"),
    STRICT_PASSWORD_HASH_PREFIX + payload.slice(0, 28) + "/" + payload.slice(29),
    STRICT_PASSWORD_HASH_PREFIX + payload.slice(0, -1) + "/", payload + "\n", payload.replace("$2b$", "$2x$"), payload.replace("$12$", "$03$"), payload.replace("$12$", "$32$"), payload.replace("$12$", "$xx$")];
  for (const stored of malformed) assert.equal(await probe.verify(p72, stored as string), false, typeof stored === "string" ? stored.slice(0, 22) : typeof stored);
  for (const password of [null, undefined, {}, 42]) assert.equal(await probe.verify(password as string, strict72), false);
  assert.equal(probe.calls.length, 0);
});

test("valid comparison errors fail closed without exposing password/hash", async () => {
  const probe = instrument((async () => { throw new Error("Injected comparator failure"); }) as typeof bcrypt.compare);
  assert.equal(await probe.verify(p72, strict72), false); assert.equal(probe.calls.length, 1);
});

test("reader compares the entire payload and writers keep randomized salts", async () => {
  const other = await hashPassword(p72); assert.notEqual(other, strict72);
  const changed = strict72.slice(0, -1) + (strict72.endsWith(".") ? "C" : ".");
  assert.equal(await verifyPassword(p72, changed), false);
  assert.equal(await verifyPassword(" " + p72, strict72), false);
});

for (const revision of ["a", "b", "y"]) test(`legacy 2${revision} hashes retain overlong/NUL compatibility`, async () => {
  for (const cost of [4, 10]) {
    const legacy = (await bcrypt.hash(p72, cost)).replace("$2b$", "$2" + revision + "$");
    assert.equal(await verifyPassword(p72 + "historical suffix", legacy), true); assert.equal(await verifyPassword("Wrong" + p72.slice(5), legacy), false);
  }
  const nulLegacy = await bcrypt.hash(p71, 4); assert.equal(await verifyPassword(p71 + "\0", nulLegacy), true);
});

for (const role of ["student", "teacher", "admin"]) for (const kind of ["legacy", "strict"]) test(`${role} ${kind} login preserves hash/version and cookie isolation`, async () => {
  const f = authFixture(), user = f.users.get(role)!; user.password = kind === "strict" ? strict72 : bcrypt.hashSync(p72, 4);
  const stored = user.password, input = kind === "legacy" ? p72 + "HistoricalSuffix" : p72;
  assert.equal((await f.post("auth/login", { email: user.email, password: input, role })).status, 200);
  assert.equal(user.password, stored); assert.equal(user.sessionVersion, 0);
  const cookie = role === "admin" ? "ps_session_admin" : "ps_session_user", other = role === "admin" ? "ps_session_user" : "ps_session_admin";
  assert.ok(f.cookies.has(cookie)); assert.equal(f.cookies.has(other), false); assert.equal(f.cookieOptions.get(cookie)!.httpOnly, true);
  const invalid = authFixture(); invalid.users.get(role)!.password = strict72;
  assert.equal((await invalid.post("auth/login", { email: user.email, password: p72 + "x", role })).status, 401); assert.equal(invalid.cookies.size, 0);
});

for (const role of ["student", "teacher"]) test(`${role} registration writes strict hashes and rejects NUL before persistence`, async () => {
  const f = authFixture();
  for (const password of ["Synthetic\0Password123", p72 + "x"]) {
    assert.equal((await f.post("auth/register", { fullName: "New Person", email: "new@example.test", password, confirmPassword: password, role })).status, 400);
    assert.equal(f.users.size, 3); assert.equal(f.cookies.size, 0);
  }
  const response = await f.post("auth/register", { fullName: "New Person", email: "new@example.test", password: p72, confirmPassword: p72, role });
  assert.equal(response.status, 201); assert.ok(f.users.get("new-user")!.password.startsWith(STRICT_PASSWORD_HASH_PREFIX)); assert.equal(await verifyPassword(p72, f.users.get("new-user")!.password), true);
});

for (const role of ["student", "teacher", "admin"]) test(`${role} profile change preserves authorization and revokes old signed sessions atomically`, async () => {
  const f = authFixture(), user = f.users.get(role)!, cookie = role === "admin" ? "ps_session_admin" : "ps_session_user";
  const token = f.token(role); f.cookies.set(cookie, token); const oldHash = user.password;
  const put = (body: Record<string, string>) => f.load("src/app/api/auth/profile/route.ts").PUT(new Request(`https://app.example.test/api/auth/profile?scope=${role === "admin" ? "admin" : "user"}`, { method: "PUT", headers: { Origin: "https://app.example.test", "Content-Type": "application/json" }, body: JSON.stringify(body) })) as Promise<Response>;
  assert.equal((await put({ fullName: user.fullName })).status, 200); assert.equal(user.password, oldHash); assert.equal(user.sessionVersion, 0);
  const body = { currentPassword: "FixturePassword123", newPassword: p72 };
  assert.equal((await put({ ...body, newPassword: "Invalid\0Password123" })).status, 400); assert.equal(user.password, oldHash); assert.equal(user.sessionVersion, 0);
  f.failAudit(); assert.equal((await put(body)).status, 500); assert.equal(f.users.get(role)!.password, oldHash); assert.equal(f.users.get(role)!.sessionVersion, 0);
  const success = authFixture(), current = success.users.get(role)!; success.cookies.set(cookie, success.token(role)); const previous = success.cookies.get(cookie)!;
  const response = await success.load("src/app/api/auth/profile/route.ts").PUT(new Request(`https://app.example.test/api/auth/profile?scope=${role === "admin" ? "admin" : "user"}`, { method: "PUT", headers: { Origin: "https://app.example.test", "Content-Type": "application/json" }, body: JSON.stringify(body) }));
  assert.equal(response.status, 200); assert.equal(current.sessionVersion, 1); assert.equal(await verifyPassword(p72, current.password), true);
  const refreshed = success.cookies.get(cookie)!; assert.notEqual(refreshed, previous); success.cookies.set(cookie, previous);
  const read = () => role === "admin" ? success.auth.getAdminSession({ touchActivity: false }) : success.auth.getUserSession(undefined, { touchActivity: false });
  assert.equal(await read(), null); success.cookies.set(cookie, refreshed); assert.equal((await read()).sessionVersion, 1);
  const storedStrict = current.password;
  const changeStrict = (currentPassword: string) => success.load("src/app/api/auth/profile/route.ts").PUT(new Request(`https://app.example.test/api/auth/profile?scope=${role === "admin" ? "admin" : "user"}`, { method: "PUT", headers: { Origin: "https://app.example.test", "Content-Type": "application/json" }, body: JSON.stringify({ currentPassword, newPassword: "ReplacementPassword123" }) })) as Promise<Response>;
  assert.equal((await changeStrict(p72 + "suffix")).status, 400); assert.equal(current.password, storedStrict); assert.equal(current.sessionVersion, 1); assert.equal(success.cookies.get(cookie), refreshed);
  assert.equal((await changeStrict(p72)).status, 200); assert.equal(current.sessionVersion, 2); assert.equal(await verifyPassword("ReplacementPassword123", current.password), true);
  const secondRefresh = success.cookies.get(cookie)!; success.cookies.set(cookie, refreshed); assert.equal(await read(), null);
  success.cookies.set(cookie, secondRefresh); assert.equal((await read()).sessionVersion, 2);
});

for (const role of ["student", "teacher", "admin"]) test(`${role} reset: strict write, revocation and rollback preserve OTP/password/version consistency`, async () => {
  for (const fail of [false, true]) {
    const f = authFixture(), user = f.users.get(role)!, oldHash = user.password, cookie = role === "admin" ? "ps_session_admin" : "ps_session_user";
    const token = f.token(role); f.cookies.set(cookie, token); f.otps.push({ id: 1, userId: role, code: `password-reset:${role}:123456`, expiresAt: new Date(Date.now() + 60_000) });
    const request = (password: string) => f.post("auth/reset-password", { email: user.email, otpCode: "123456", newPassword: password });
    assert.equal((await request("Invalid\0Password123")).status, 400); assert.equal(f.otps.length, 1); assert.equal(user.password, oldHash); assert.equal(user.sessionVersion, 0);
    if (fail) f.failAudit(); const response = await request(p72);
    assert.equal(response.status, fail ? 500 : 200);
    const updated = f.users.get(role)!; assert.equal(updated.sessionVersion, fail ? 0 : 1); assert.equal(f.otps.length, fail ? 1 : 0);
    if (fail) assert.equal(updated.password, oldHash);
    else { assert.equal(await verifyPassword(p72, updated.password), true); assert.equal(await verifyPassword("FixturePassword123", updated.password), false);
      assert.equal(await (role === "admin" ? f.auth.getAdminSession({ touchActivity: false }) : f.auth.getUserSession(undefined, { touchActivity: false })), null); }
  }
});

for (const role of ["student", "teacher"]) for (const kind of ["legacy", "strict"]) test(`${role} Google OTP works with ${kind} password representation`, async () => {
  const f = authFixture(), user = f.users.get(role)!; if (kind === "strict") user.password = strict72; const stored = user.password;
  const begin = await f.post("auth/google", { mode: "begin" }); assert.equal(begin.status, 200); const intent = await begin.json(); f.googleNonce(intent.nonce); f.googleIdentity(role);
  const google = await f.post("auth/google", { mode: "signin", credential: "verified-fixture", intent: intent.intent }); assert.equal(google.status, 200); const data = await google.json();
  assert.equal(f.cookies.size, 0); assert.equal((await f.post("auth/verify-otp", { userId: role, otpCode: "123456", challenge: data.challenge })).status, 200);
  assert.equal(user.password, stored); assert.equal(user.sessionVersion, 0); assert.ok(f.cookies.has("ps_session_user")); assert.equal(f.cookies.has("ps_session_admin"), false);
});

test("new Google placeholder hashes use strict writer without enabling Admin Google access", async () => {
  const f = authFixture(); f.users.delete("student"); f.googleIdentity("student");
  assert.equal((await f.post("auth/google", { credential: "verified-fixture", role: "student" })).status, 200);
  assert.ok(f.users.get("new-user")!.password.startsWith(STRICT_PASSWORD_HASH_PREFIX));
  f.googleIdentity("admin"); assert.equal((await f.post("auth/google", { credential: "verified-fixture", role: "admin" })).status, 400);
});

test("rollback retaining the actual dual reader handles mixed records; raw-only rollback is incompatible", async () => {
  const retainedReader = instrument(), legacy = bcrypt.hashSync(p72, 4);
  assert.equal(await retainedReader.verify(p72, strict72), true); assert.equal(await retainedReader.verify(p72 + "suffix", strict72), false);
  assert.equal(await retainedReader.verify(p72 + "suffix", legacy), true);
  assert.equal(await bcrypt.compare(p72, strict72), false);
  assert.equal(legacy.length, 60); assert.equal(strict72.length, 71);
});
