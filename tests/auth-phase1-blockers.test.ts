import assert from "node:assert/strict";
import test from "node:test";
import { authFixture } from "./helpers/auth-fixture.ts";

const origin = "https://app.example.test";
function put(f: ReturnType<typeof authFixture>, route: string, body: unknown, query = "") {
  return f.load(`src/app/api/${route}/route.ts`).PUT(new Request(`${origin}/api/${route}${query}`, {
    method: "PUT", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body),
  }));
}

test("token preparation never signs a changed role returned by persistence", async () => {
  const f = authFixture(), user = f.users.get("teacher")!;
  await assert.rejects(f.auth.prepareSessionToken({ userId: user.id, email: user.email, fullName: user.fullName, role: "teacher" }, f.snapshot("teacher"), {
    user: { update: async () => ({ ...user, role: { roleName: "admin" } }) },
  }), /Authentication changed/);
  assert.equal(f.cookies.size, 0);
});

for (const role of ["teacher", "student", "admin"]) {
  test(`${role} profile cannot reissue another class when role changes after authentication`, async () => {
    const f = authFixture(), cookie = role === "admin" ? "ps_session_admin" : "ps_session_user";
    const original = f.token(role); f.cookies.set(cookie, original);
    const read = f.auth.getScopedSession;
    f.auth.getScopedSession = async (...args: any[]) => {
      const session = await read(...args);
      f.users.get(role)!.role.roleName = role === "admin" ? "teacher" : "admin";
      return session;
    };
    const response = await put(f, "auth/profile", { fullName: "Forbidden mutation" }, `?scope=${role === "admin" ? "admin" : "user"}`);
    assert.equal(response.status, 401);
    assert.equal(f.users.get(role)!.fullName, role); assert.equal(f.logs.length, 0);
    assert.equal(f.cookies.get(cookie), original); assert.equal(f.cookieOptions.size, 0);
  });
}

for (const route of ["auth/profile", "users/me"]) {
  test(`${route} role change just before conditional update rolls back and issues no cookie`, async () => {
    const f = authFixture(); f.cookies.set("ps_session_user", f.token("teacher"));
    f.beforeUpdate(() => { f.users.get("teacher")!.role.roleName = "admin"; });
    const response = await put(f, route, { fullName: "Forbidden name" }, "?scope=user&role=teacher");
    assert.equal(response.status, 401); assert.equal(f.users.get("teacher")!.fullName, "teacher");
    assert.equal(f.cookieOptions.size, 0); assert.equal(f.logs.length, 0);
  });
  test(`${route} signing failure after profile update rolls back all writes`, async () => {
    const f = authFixture(); f.cookies.set("ps_session_user", f.token("teacher"));
    f.auth.prepareSessionToken = async () => { throw new Error("Injected signing failure"); };
    assert.equal((await put(f, route, { fullName: "Rolled back" })).status, 500);
    assert.equal(f.users.get("teacher")!.fullName, "teacher"); assert.equal(f.logs.length, 0); assert.equal(f.cookieOptions.size, 0);
  });
}

test("profile audit failure rolls back name/password/version and prepared session", async () => {
  const f = authFixture(), before = structuredClone(f.users.get("teacher"));
  f.cookies.set("ps_session_user", f.token("teacher")); f.failAudit();
  assert.equal((await put(f, "auth/profile", { fullName: "Rollback", currentPassword: "FixturePassword123", newPassword: "NewFixturePassword123" })).status, 500);
  assert.equal(f.users.get("teacher")!.fullName, before!.fullName);
  assert.equal(f.users.get("teacher")!.password, before!.password); assert.equal(f.users.get("teacher")!.sessionVersion, 0);
  assert.equal(f.logs.length, 0); assert.equal(f.cookieOptions.size, 0);
});

test("postcommit cookie transport failure reports failure without issuing another class", async () => {
  const f = authFixture(); f.cookies.set("ps_session_user", f.token("teacher")); f.failCookie();
  assert.equal((await put(f, "auth/profile", { fullName: "Committed name" })).status, 500);
  assert.equal(f.users.get("teacher")!.fullName, "Committed name"); assert.equal(f.logs.length, 1);
  assert.equal(f.cookies.size, 0); assert.equal(f.cookieOptions.size, 0);
});

for (const role of ["teacher", "student"]) test(`${role} scoped consumers reject replacement Admin identity/data/mutations/Pusher`, async () => {
  const f = authFixture(); f.cookies.set("ps_session_admin", f.token("admin"));
  const scope = `?scope=user&role=${role}`;
  for (const route of ["auth/session", "notifications"]) {
    const response = await f.load(`src/app/api/${route}/route.ts`).GET(new Request(`${origin}/api/${route}${scope}`));
    assert.equal(response.status, 401); assert.doesNotMatch(JSON.stringify(await response.json()), /admin@example|admin notification/);
  }
  for (const route of ["auth/profile", "users/me", "notifications"]) {
    assert.equal((await put(f, route, { fullName: "Admin overwritten", id: "all" }, scope)).status, 401);
  }
  const response = await f.load("src/app/api/pusher/auth/route.ts").POST(new Request(`${origin}/api/pusher/auth${scope}`, {
    method: "POST", body: new URLSearchParams({ socket_id: "1.2", channel_name: "private-user-admin" }),
  }));
  assert.equal(response.status, 401); assert.equal(f.users.get("admin")!.fullName, "admin"); assert.equal(f.events.length, 0);
});

for (const role of ["teacher", "student", "admin"]) test(`valid ${role} explicit scope preserves profile/notifications/session/realtime`, async () => {
  const f = authFixture(), scope = role === "admin" ? "?scope=admin" : `?scope=user&role=${role}`;
  f.cookies.set(role === "admin" ? "ps_session_admin" : "ps_session_user", f.token(role));
  const session = await f.load("src/app/api/auth/session/route.ts").GET(new Request(`${origin}/api/auth/session${scope}`));
  assert.equal(session.status, 200); assert.equal((await session.json()).user.role, role);
  const notifications = await f.load("src/app/api/notifications/route.ts").GET(new Request(`${origin}/api/notifications${scope}`));
  assert.equal(notifications.status, 200); assert.equal((await notifications.json()).notifications[0].title, `${role} notification`);
  assert.equal((await put(f, "notifications", { id: "all" }, scope)).status, 200);
  assert.equal((await put(f, "auth/profile", { fullName: `Fresh ${role}` }, scope)).status, 200);
  const reader = role === "admin" ? f.auth.getAdminSession : f.auth.getUserSession;
  assert.equal((await reader()).role, role); assert.equal((await reader()).fullName, `Fresh ${role}`);
  const pusher = await f.load("src/app/api/pusher/auth/route.ts").POST(new Request(`${origin}/api/pusher/auth${scope}`, {
    method: "POST", body: new URLSearchParams({ socket_id: "1.2", channel_name: `private-user-${role}` }),
  }));
  assert.equal(pusher.status, 200);
});

test("unscoped and invalid consumer scopes cannot fall back to Admin", async () => {
  const f = authFixture(); f.cookies.set("ps_session_admin", f.token("admin"));
  for (const query of ["", "?scope=invalid", "?scope=user&role=admin", "?scope=user&role=student"]) {
    assert.equal((await f.load("src/app/api/auth/session/route.ts").GET(new Request(`${origin}/api/auth/session${query}`))).status, 401);
  }
  assert.equal((await put(f, "users/me", { fullName: "Forbidden" }, "?scope=admin")).status, 401);
});

function assertCleanup(response: Response) {
  const headers = response.headers.getSetCookie();
  assert.equal(headers.length, 4);
  for (const name of ["ps_session_admin", "ps_session_user", "ps_session_teacher", "ps_session_student"]) {
    assert.ok(headers.some(header => header.startsWith(`${name}=;`) && /Max-Age=0/.test(header)));
  }
}

for (const unavailable of [false, true]) test(`actual write gate ${unavailable ? "unavailable" : "paused"} still clears logout cookies`, async () => {
  const f = authFixture(); f.cookies.set("ps_session_admin", f.token("admin")); f.cookies.set("ps_session_teacher", "legacy"); f.pauseGate(unavailable);
  const response = await f.post("auth/logout"); assert.equal(response.status, 503); assertCleanup(response);
  assert.deepEqual(await response.json(), { success: false, cookiesCleared: true, serverRevocation: "failed", error: "Session revocation unavailable; please retry" });
  assert.equal(response.headers.get("Retry-After"), "30"); assert.equal(f.cookies.size, 0);
  assert.equal(f.users.get("admin")!.sessionVersion, 0); assert.equal(f.logs.length, 0); assert.equal(f.afterWork.length, 0);
});

test("logout revocation/audit rollback still clears every cookie and reports failure", async () => {
  const f = authFixture(); f.cookies.set("ps_session_user", f.token("student")); f.failAudit();
  const response = await f.post("auth/logout"); assert.equal(response.status, 503); assertCleanup(response);
  assert.equal((await response.json()).serverRevocation, "failed"); assert.equal(f.cookies.size, 0);
  assert.equal(f.users.get("student")!.sessionVersion, 0); assert.equal(f.logs.length, 0); assert.equal(f.afterWork.length, 0);
});

test("conflicting current/legacy logout cookies all clear without arbitrary revocation", async () => {
  const f = authFixture(); f.cookies.set("ps_session_admin", f.token("admin")); f.cookies.set("ps_session_user", f.token("teacher"));
  f.cookies.set("ps_session_teacher", "legacy"); f.cookies.set("ps_session_student", "legacy");
  const response = await f.post("auth/logout"); assert.equal(response.status, 409); assertCleanup(response);
  assert.equal((await response.json()).serverRevocation, "not_performed"); assert.equal(f.cookies.size, 0); assert.equal(f.logs.length, 0);
});

for (const stalled of [false, true]) test(`logout response and cookie cleanup precede ${stalled ? "stalled" : "failed"} post-response realtime`, async () => {
  const f = authFixture(), token = f.token("teacher"); f.cookies.set("ps_session_user", token);
  let calls = 0, release!: () => void;
  const stalledWork = new Promise<void>(resolve => { release = resolve; });
  f.realtime(async () => { calls++; if (stalled) await stalledWork; else throw new Error("Provider error"); });
  const response = await f.post("auth/logout"); assert.equal(response.status, 200); assertCleanup(response);
  assert.equal((await response.json()).serverRevocation, "succeeded"); assert.equal(f.cookies.size, 0);
  assert.equal(f.users.get("teacher")!.sessionVersion, 1); assert.equal(f.logs.length, 1); assert.equal(calls, 0);
  f.cookies.set("ps_session_user", token); assert.equal(await f.auth.getUserSession(), null);
  const background = f.flushAfter(); assert.equal(calls, 1); release(); await background;
});

test("foreign logout Origin cannot clear an existing valid session", async () => {
  const f = authFixture(); const token = f.token("admin"); f.cookies.set("ps_session_admin", token);
  const response = await f.post("auth/logout", {}, "https://foreign.example.test");
  assert.equal(response.status, 403); assert.equal(response.headers.getSetCookie().length, 0); assert.equal(f.cookies.get("ps_session_admin"), token);
});
