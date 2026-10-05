import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import ts from "typescript";
import jwt from "jsonwebtoken";
import { authFixture } from "./helpers/auth-fixture.ts";
import { getAuthDestination } from "../src/lib/auth-destination.ts";

const { NextRequest, NextResponse } = createRequire(import.meta.url)("next/server");
type Fixture = ReturnType<typeof authFixture>;
const roles = ["admin", "teacher", "student"] as const;
const cookieName = (role: string) => role === "admin" ? "ps_session_admin" : "ps_session_user";

// Execute the actual Proxy with real Next request/response construction, JWT,
// DB predicates, browser-generation scripts, and logout/login implementations.
// Only external persistence is mocked by the existing owned auth fixture.
function navigation(fixture: Fixture, readerFailure = false) {
  const exports = {} as { proxy: (request: unknown) => Response | Promise<Response> };
  const reads: unknown[][] = [];
  const code = ts.transpileModule(fs.readFileSync("src/proxy.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(code, {
    exports, Headers, URL, process: { env: { NODE_ENV: "production" } },
    require(name: string) {
      if (name === "next/server") return { NextResponse };
      if (name === "@/lib/auth-destination") return { getAuthDestination };
      if (name === "@/lib/auth") return { ...fixture.auth, getSession: (...args: unknown[]) => {
        reads.push(args);
        if (readerFailure) throw new Error("Injected session reader failure");
        return fixture.auth.getSession(...args);
      } };
      throw new Error(`Unexpected root navigation dependency: ${name}`);
    },
  });
  const snapshot = () => ({ users: structuredClone(fixture.users), cookies: [...fixture.allCookies()],
    cookieOptions: [...fixture.cookieOptions], browserCookieOptions: [...fixture.browserCookieOptions],
    generations: [...fixture.generations.values], expiry: [...fixture.generations.expires],
    logs: [...fixture.logs], events: [...fixture.events], rateCalls: [...fixture.rateCalls] });
  return {
    reads,
    async visit(path = "/", method = "GET") {
      const before = snapshot();
      const cookie = [...fixture.allCookies()].map(([name, value]) => `${name}=${value}`).join("; ");
      const response = await exports.proxy(new NextRequest(`https://app.example.test${path}`, {
        method, headers: { Cookie: cookie },
      }));
      assert.deepEqual(snapshot(), before, "Navigation must not write accounts, cookies, generations, or audit events");
      assert.equal(response.headers.get("Set-Cookie"), null, "Navigation must not delete or issue cookies");
      return response;
    },
  };
}

function authenticated(role: string) {
  const fixture = authFixture();
  fixture.users.get(role)!.lastSeenAt = new Date(0);
  fixture.cookies.set(cookieName(role), fixture.token(role));
  return fixture;
}

function publicHomepage(response: Response) {
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Location"), null);
  assert.equal(response.headers.get("x-middleware-next"), "1", "Continue to the untouched public page");
  assert.equal(response.headers.get("x-middleware-rewrite"), null);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store, max-age=0");
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
}

function dashboard(response: Response, role: string) {
  assert.equal(response.status, 307);
  assert.equal(response.headers.get("Location"), `https://app.example.test/dashboard/${role}`);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store, max-age=0");
  assert.equal(response.headers.get("X-Frame-Options"), "DENY");
}

test("anonymous exact-root GET continues to the existing homepage", async () => {
  publicHomepage(await navigation(authFixture()).visit());
});

for (const role of roles) {
  test(`current DB/browser-validated ${role} redirects before homepage rendering; dashboard does not loop`, async () => {
    const fixture = authenticated(role);
    fixture.failCookie();
    const root = navigation(fixture);
    dashboard(await root.visit(), role);
    assert.equal(root.reads.length, 1);
    assert.equal(root.reads[0][0], undefined, "No caller-selected role hint");
    assert.equal((root.reads[0][1] as { touchActivity: boolean }).touchActivity, false);
    const destination = await root.visit(`/dashboard/${role}`);
    assert.equal(destination.status, 200);
    assert.equal(destination.headers.get("Location"), null);
    assert.equal(root.reads.length, 1, "Root decision never runs on a dashboard");
  });

  for (const scenario of ["expired", "bad signature", "wrong sessionClass", "wrong cookie class",
    "deleted", "inactive", "suspended", "revoked", "role changed", "unknown DB role", "malformed"] as const) {
    test(`${role} ${scenario} session cannot redirect root to a protected identity`, async () => {
      const fixture = authenticated(role);
      const name = cookieName(role);
      const token = fixture.cookies.get(name)!;
      const claims = jwt.decode(token) as jwt.JwtPayload;
      if (scenario === "expired") fixture.cookies.set(name, jwt.sign({ ...claims, exp: 1 }, fixture.environment.NEXTAUTH_SECRET));
      if (scenario === "bad signature") fixture.cookies.set(name, jwt.sign(claims, "different-fixture-only-signing-secret"));
      if (scenario === "wrong sessionClass") fixture.cookies.set(name, jwt.sign({ ...claims, sessionClass: role === "admin" ? "user" : "admin" }, fixture.environment.NEXTAUTH_SECRET));
      if (scenario === "wrong cookie class") {
        fixture.cookies.delete(name);
        fixture.cookies.set(role === "admin" ? "ps_session_user" : "ps_session_admin", token);
      }
      if (scenario === "deleted") fixture.users.delete(role);
      if (scenario === "inactive" || scenario === "suspended") fixture.users.get(role)!.status = scenario;
      if (scenario === "revoked") fixture.users.get(role)!.sessionVersion++;
      if (scenario === "role changed") fixture.users.get(role)!.role.roleName = role === "student" ? "teacher" : "student";
      if (scenario === "unknown DB role") fixture.users.get(role)!.role.roleName = "owner";
      if (scenario === "malformed") fixture.cookies.set(name, "not-a-jwt");
      publicHomepage(await navigation(fixture).visit());
    });
  }

  test(`${role} obsolete browser generation cannot redirect root`, async () => {
    const fixture = authenticated(role);
    const browserId = fixture.browserCookies.get("ps_browser_auth")!;
    const key = `proctorshield:browser-auth:${browserId}`;
    const deadline = fixture.generations.values.get(key)!.split("|")[1];
    fixture.generations.values.set(key, `${randomUUID()}|${deadline}`);
    publicHomepage(await navigation(fixture).visit());
  });

  for (const failure of ["database", "Redis", "missing browser cookie", "expired browser state"] as const) {
    test(`${role} ${failure} never falls back to the JWT role`, async () => {
      const fixture = authenticated(role);
      if (failure === "database") fixture.failRead();
      if (failure === "Redis") fixture.generations.fail();
      if (failure === "missing browser cookie") fixture.browserCookies.delete("ps_browser_auth");
      if (failure === "expired browser state") {
        const key = `proctorshield:browser-auth:${fixture.browserCookies.get("ps_browser_auth")}`;
        fixture.generations.values.delete(key);
        fixture.generations.expires.delete(key);
      }
      publicHomepage(await navigation(fixture).visit());
    });
  }

  test(`${role} real logout revokes retained cookies; root and login become anonymous`, async () => {
    const fixture = authFixture();
    assert.equal((await fixture.post("auth/login", { email: `${role}@example.test`, password: "FixturePassword123" })).status, 200);
    const root = navigation(fixture);
    dashboard(await root.visit(), role);
    const token = fixture.cookies.get(cookieName(role));
    const logout = await fixture.post("auth/logout");
    assert.equal(logout.status, 200);
    assert.equal((await logout.json()).serverRevocation, "succeeded");
    assert.equal(fixture.cookies.get(cookieName(role)), token, "Retained revoked cookies remain safe on root");
    publicHomepage(await root.visit());
    assert.equal(await fixture.auth.getSession(undefined, { touchActivity: false }), null);
    const login = await root.visit("/login");
    assert.equal(login.status, 200);
    assert.equal(login.headers.get("Location"), null);
  });
}

for (const role of ["teacher", "student"]) test(`both valid Admin and ${role} cookies deny root identity selection`, async () => {
  const fixture = authenticated(role);
  fixture.cookies.set("ps_session_admin", fixture.token("admin"));
  // Prove each scoped cookie is valid, so ambiguity is the reason for denial.
  assert.equal((await fixture.auth.getAdminSession({ touchActivity: false })).role, "admin");
  assert.equal((await fixture.auth.getUserSession(undefined, { touchActivity: false })).role, role);
  publicHomepage(await navigation(fixture).visit());
});

test("valid User plus malformed Admin cookie remains ambiguous and unchanged", async () => {
  const fixture = authenticated("student");
  fixture.cookies.set("ps_session_admin", "malformed");
  publicHomepage(await navigation(fixture).visit());
});

test("legacy cookies cannot select a root dashboard", async () => {
  const fixture = authFixture();
  fixture.cookies.set("ps_session_teacher", fixture.token("teacher"));
  fixture.cookies.set("ps_session_student", fixture.token("student"));
  publicHomepage(await navigation(fixture).visit());
});

test("session-reader exception keeps root public without guessing an identity", async () => {
  publicHomepage(await navigation(authenticated("admin"), true).visit());
});

test("same-browser Teacher to Student login makes root use Student and rejects the obsolete Teacher token", async () => {
  const fixture = authFixture();
  assert.equal((await fixture.post("auth/login", { email: "teacher@example.test", password: "FixturePassword123" })).status, 200);
  const root = navigation(fixture);
  dashboard(await root.visit(), "teacher");
  const obsolete = fixture.cookies.get("ps_session_user")!;
  assert.equal((await fixture.post("auth/login", { email: "student@example.test", password: "FixturePassword123" })).status, 200);
  const current = fixture.cookies.get("ps_session_user")!;
  dashboard(await root.visit(), "student");
  fixture.cookies.set("ps_session_user", obsolete);
  publicHomepage(await root.visit());
  fixture.cookies.set("ps_session_user", current);
  dashboard(await root.visit(), "student");
});

test("root query markers cannot select a role or leak a retake marker to the dashboard", async () => {
  const path = "/?role=admin&reason=session-changed&_retakeStudent=admin&next=https://evil.example.test";
  publicHomepage(await navigation(authFixture()).visit(path));
  dashboard(await navigation(authenticated("student")).visit(path), "student");
});

for (const path of ["/login", "/login?reason=session-changed", "/login/student", "/login/teacher", "/admin/login", "/api/health"]) {
  test(`exact-root decision leaves ${path} on its existing routing path`, async () => {
    const route = navigation(authenticated("teacher"));
    const response = await route.visit(path);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Location"), null);
    assert.equal(route.reads.length, 0);
  });
}

test("HEAD root requests also resolve the current identity without mutation", async () => {
  dashboard(await navigation(authenticated("admin")).visit("/", "HEAD"), "admin");
});
