import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import jwt from "jsonwebtoken";
import { authFixture } from "./helpers/auth-fixture.ts";
import { getAuthDestination } from "../src/lib/auth-destination.ts";
import { fixture as dashboardFixture, find, textOf } from "./helpers/dashboard-lifecycle-fixture.ts";

type Fixture = ReturnType<typeof authFixture>;
type Params = Record<string, string | string[] | undefined>;
const content = Symbol("existing unified password form");
class Redirect extends Error {
  readonly destination: string;
  constructor(destination: string) { super("NEXT_REDIRECT"); this.destination = destination; }
}

// Execute the actual server page and strict JWT/DB readers. Only the framework
// redirect and client boundary are mocked; no configured DB or network is used.
function page(fixture: Fixture, readFailure = false) {
  const exports: { default?: (props: { searchParams: Promise<Params> }) => Promise<unknown> } = {};
  const calls: Array<{ name: string; args: unknown[] }> = [];
  const code = ts.transpileModule(fs.readFileSync("src/app/login/page.tsx", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(code, {
    exports,
    require(name: string) {
      if (name === "react/jsx-runtime") return { jsx: (type: unknown, props: unknown) => ({ type, props }) };
      if (name === "next/navigation") return { redirect: (path: string) => { throw new Redirect(path); } };
      if (name === "./content") return { __esModule: true, default: content };
      if (name === "@/lib/auth-destination") return { getAuthDestination };
      if (name === "@/lib/auth") return new Proxy({}, { get: (_target, key) => (...args: unknown[]) => {
        calls.push({ name: String(key), args });
        assert.equal(key, "getSession", "Page must not issue cookies or call logout");
        if (readFailure) throw new Error("Injected private session transport failure");
        return fixture.auth.getSession(...args);
      } });
      throw new Error(`Unexpected server page dependency: ${name}`);
    },
  });
  return {
    calls,
    async visit(params: Params = {}) {
      const before = { users: structuredClone(fixture.users), cookies: [...fixture.cookies],
        cookieOptions: [...fixture.cookieOptions], logs: [...fixture.logs], events: [...fixture.events] };
      let result;
      try {
        const rendered = await exports.default!({ searchParams: Promise.resolve(params) }) as { type: unknown; props: { sessionUnavailable?: boolean } };
        assert.equal(rendered.type, content, "Unauthenticated/failed validation must render the existing form");
        result = { kind: "form", unavailable: rendered.props.sessionUnavailable === true } as const;
      } catch (error) {
        if (!(error instanceof Redirect)) throw error;
        result = { kind: "redirect", destination: error.destination } as const;
      }
      assert.deepEqual({ users: fixture.users, cookies: [...fixture.cookies], cookieOptions: [...fixture.cookieOptions],
        logs: [...fixture.logs], events: [...fixture.events] }, before, "GET render must not mutate accounts/cookies or trigger logout");
      return result;
    },
  };
}

function authenticated(role: string) {
  const fixture = authFixture();
  // Deliberately stale activity would exercise the ordinary reader's write.
  fixture.users.get(role)!.lastSeenAt = new Date(0);
  fixture.cookies.set(role === "admin" ? "ps_session_admin" : "ps_session_user", fixture.token(role));
  fixture.failCookie();
  return fixture;
}

for (const role of ["admin", "teacher", "student"]) {
  test(`current DB-validated ${role} visiting /login redirects without any session/account mutation`, async () => {
    const fixture = authenticated(role);
    const login = page(fixture);
    assert.deepEqual(await login.visit(), { kind: "redirect", destination: `/dashboard/${role}` });
    assert.equal(login.calls.length, 1);
    assert.equal(login.calls[0].args[0], undefined);
    assert.equal((login.calls[0].args[1] as { touchActivity: boolean }).touchActivity, false);
  });

  for (const scenario of ["expired", "bad signature", "wrong sessionClass", "wrong cookie class", "deleted",
    "inactive", "suspended", "revoked", "role changed", "unknown DB role", "malformed"] as const) {
    test(`${role} ${scenario} session never causes an authenticated redirect`, async () => {
      const fixture = authenticated(role);
      const name = role === "admin" ? "ps_session_admin" : "ps_session_user";
      const token = fixture.cookies.get(name)!;
      const claims = jwt.decode(token) as jwt.JwtPayload;
      if (scenario === "expired") fixture.cookies.set(name, jwt.sign({ ...claims, exp: 1 }, fixture.environment.NEXTAUTH_SECRET));
      if (scenario === "bad signature") fixture.cookies.set(name, jwt.sign(claims, "different-fixture-only-signing-secret"));
      if (scenario === "wrong sessionClass") fixture.cookies.set(name, jwt.sign({ ...claims, sessionClass: role === "admin" ? "user" : "admin" }, fixture.environment.NEXTAUTH_SECRET));
      if (scenario === "wrong cookie class") { fixture.cookies.delete(name); fixture.cookies.set(role === "admin" ? "ps_session_user" : "ps_session_admin", token); }
      if (scenario === "deleted") fixture.users.delete(role);
      if (scenario === "inactive" || scenario === "suspended") fixture.users.get(role)!.status = scenario;
      if (scenario === "revoked") fixture.users.get(role)!.sessionVersion++;
      if (scenario === "role changed") fixture.users.get(role)!.role.roleName = role === "student" ? "teacher" : "student";
      if (scenario === "unknown DB role") fixture.users.get(role)!.role.roleName = "owner";
      if (scenario === "malformed") fixture.cookies.set(name, "not-a-jwt");
      assert.deepEqual(await page(fixture).visit(), { kind: "form", unavailable: false });
    });
  }

  test(`${role} database validation outage displays the form with a safe unavailable notice`, async () => {
    const fixture = authenticated(role);
    fixture.failRead();
    assert.deepEqual(await page(fixture).visit(), { kind: "form", unavailable: true });
  });

  for (const params of [{ reason: "session-changed" }, { reason: ["other", "session-changed"] }, { _retakeStudent: "student" }]) {
    test(`${role} replacement cannot be adopted from explicit reauthentication context ${JSON.stringify(params)}`, async () => {
      const login = page(authenticated(role));
      assert.deepEqual(await login.visit(params), { kind: "form", unavailable: false });
      assert.equal(login.calls.length, 0);
    });
  }
}

test("anonymous visitor renders the Phase 2A form", async () => {
  assert.deepEqual(await page(authFixture()).visit(), { kind: "form", unavailable: false });
});

test("legacy role cookies are not accepted as an authenticated identity", async () => {
  const fixture = authFixture();
  fixture.cookies.set("ps_session_student", fixture.token("student"));
  fixture.cookies.set("ps_session_teacher", fixture.token("teacher"));
  assert.deepEqual(await page(fixture).visit(), { kind: "form", unavailable: false });
});

for (const role of ["teacher", "student"]) {
  test(`both valid Admin and ${role} cookies deny implicit identity selection`, async () => {
    const fixture = authenticated(role);
    fixture.cookies.set("ps_session_admin", fixture.token("admin"));
    assert.deepEqual(await page(fixture).visit(), { kind: "form", unavailable: false });
  });
}

test("a valid cookie plus a malformed opposite cookie remains ambiguous and is not cleared", async () => {
  const fixture = authenticated("student");
  fixture.cookies.set("ps_session_admin", "malformed");
  assert.deepEqual(await page(fixture).visit(), { kind: "form", unavailable: false });
});

test("session transport failure is distinguished from anonymous without swallowing redirect exceptions", async () => {
  assert.deepEqual(await page(authFixture(), true).visit(), { kind: "form", unavailable: true });
});

for (const role of ["admin", "teacher", "student"]) test(`existing ${role} readers retain their default activity behavior`, async () => {
  const fixture = authenticated(role);
  const session = role === "admin" ? await fixture.auth.getAdminSession() : await fixture.auth.getUserSession(role);
  assert.equal(session.role, role);
  assert.equal(fixture.users.get(role)!.isOnline, true);
  assert.notEqual(fixture.users.get(role)!.lastSeenAt.getTime(), 0);
  assert.equal(fixture.users.get(role)!.sessionVersion, 0);
});

for (const [staleRole, replacement] of [["student", "teacher"], ["student", "admin"],
  ["teacher", "student"], ["teacher", "admin"]] as const) {
  test(`real ${staleRole} session-loss link with ${replacement} replacement renders reauthentication instead of adopting replacement`, async () => {
    const fixture = authFixture();
    assert.equal((await fixture.post("auth/login", { email: `${staleRole}@example.test`, password: "FixturePassword123" })).status, 200);
    const shell = dashboardFixture(staleRole, fixture);
    try {
      shell.render(); await shell.ready();
      assert.match(textOf(shell.render()), staleRole === "student" ? /Private Student quiz/ : /Private Teacher result/);
      const probe = shell.shellCallback("notification");
      assert.equal((await fixture.post("auth/login", { email: `${replacement}@example.test`, password: "FixturePassword123" })).status, 200);
      probe(); await shell.ready();
      const lost = shell.render();
      assert.match(textOf(lost), /Your session has expired or changed/);
      assert.doesNotMatch(textOf(lost), /Private Student quiz|Private Teacher result/);
      const link = find(lost, node => node.type === "a" && textOf(node) === "User Login");
      assert.ok(link, "Follow the real reauthentication link rendered by the production shell");
      // Simulate following its actual href; the test never supplies a marker.
      const target = new URL(String(link.props.href), "https://app.example.test");
      assert.equal(target.pathname, "/login");
      const login = page(fixture);
      assert.deepEqual(await login.visit(Object.fromEntries(target.searchParams)), { kind: "form", unavailable: false });
      assert.equal(login.calls.length, 0, "Reauthentication must not resolve/adopt the replacement identity");
      assert.deepEqual(shell.resources(), { timers: 0, connected: 0, subscriptions: 0 });
      const requestCount = shell.requests.length;
      await shell.advance(35_000);
      assert.equal(shell.requests.length, requestCount);
      assert.deepEqual(shell.pushes, []);
    } finally {
      shell.unmount(); shell.assertDisposed();
    }
  });
}

for (const params of [{ reason: "session-changed" }, { reason: "admin" }, { reason: ["unknown", "teacher"] },
  { _retakeStudent: "admin" }, { reason: "https://evil.example.test" }]) {
  test(`anonymous marker ${JSON.stringify(params)} cannot grant authorization or choose a destination`, async () => {
    assert.deepEqual(await page(authFixture()).visit(params), { kind: "form", unavailable: false });
  });
}

test("malformed reason and role parameters cannot select a different authenticated dashboard", async () => {
  assert.deepEqual(await page(authenticated("student")).visit({ reason: "teacher", role: "admin" }),
    { kind: "redirect", destination: "/dashboard/student" });
});
