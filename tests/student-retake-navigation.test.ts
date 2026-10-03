import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { authFixture } from "./helpers/auth-fixture.ts";
import { deferred, fixture, studentQuizzes } from "./helpers/dashboard-lifecycle-fixture.ts";

const paths = ["event-approval", "event-rejection", "poll-approval", "poll-rejection"] as const;
const bound = (path: string, id = "student") => `${path}?_retakeStudent=${encodeURIComponent(id)}`;
type Attempt = { studentId: string; quizId: number; attemptNumber: number; quizStatus: string; endTime: Date | null; attemptMode: string | null; quiz: { quizMode: string; quizStatus: string } };
const approvedAttempt = (): Attempt => ({ studentId: "student", quizId: 44, attemptNumber: 2, quizStatus: "enrolled", endTime: null, attemptMode: "proctored", quiz: { quizMode: "proctored", quizStatus: "ended" } });

// Run the actual proxy, JWT verifier and persisted-account predicates. Only
// Next response construction and explicitly owned database records are mocked.
function navigationBoundary(auth: ReturnType<typeof authFixture>, initial: Attempt | null = approvedAttempt()) {
  let attempt = initial, userQueries = 0, quizQueries = 0, outage = false;
  const prisma = {
    user: { findUnique: async ({ where }: { where: { id: string } }) => {
      userQueries++;
      if (outage) throw new Error("Navigation database unavailable");
      return auth.users.get(where.id) ?? null;
    } },
    studentQuiz: { findFirst: async ({ where, orderBy }: { where: { studentId: string; quizId: number }; orderBy: { attemptNumber: string } }) => {
      quizQueries++;
      assert.equal(orderBy.attemptNumber, "desc");
      return attempt?.studentId === where.studentId && attempt.quizId === where.quizId ? attempt : null;
    } },
  };
  const response = (status: number, location?: URL, body?: unknown, headers?: HeadersInit) => {
    const values = new Headers(headers);
    if (location) values.set("Location", location.toString());
    return Object.assign(new Response(body === undefined ? null : JSON.stringify(body), { status, headers: values }), { cookies: { delete() {} } });
  };
  const route = {} as { proxy: (request: unknown) => Response | Promise<Response> };
  const code = ts.transpileModule(fs.readFileSync("src/proxy.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  vm.runInNewContext(code, {
    exports: route, Headers, URL,
    process: { env: { NODE_ENV: "production" } },
    require: (name: string) => {
      if (name === "@/lib/auth") return auth.auth;
      if (name === "@/lib/prisma") return { __esModule: true, default: prisma };
      if (name === "next/server") return { NextResponse: {
        next: () => response(200), redirect: (url: URL) => response(307, url),
        json: (body: unknown, options: { status: number; headers?: HeadersInit }) => response(options.status, undefined, body, options.headers),
      } };
      throw new Error(`Unexpected navigation dependency: ${name}`);
    },
  });
  return {
    navigate: (path: string) => {
      const nextUrl = Object.assign(new URL(`https://app.example.test${path}`), { clone() { return new URL(this.toString()); } });
      return Promise.resolve(route.proxy({ nextUrl, headers: new Headers(), cookies: { get: (name: string) => auth.cookies.has(name) ? { value: auth.cookies.get(name) } : undefined } }));
    },
    attempt: (value: Attempt | null) => { attempt = value; },
    failDatabase: () => { outage = true; },
    queries: () => ({ userQueries, quizQueries }),
  };
}

async function login(auth: ReturnType<typeof authFixture>, role: "student" | "teacher" | "admin") {
  assert.equal((await auth.post("auth/login", { email: `${role}@example.test`, password: "FixturePassword123", role })).status, 200);
}

for (const role of ["teacher", "admin"] as const) for (const path of paths) {
  test(`delayed successful Student validation: ${path} cannot adopt replacement ${role}`, async () => {
    const auth = authFixture(); await login(auth, "student");
    const setup = fixture("student", auth), boundary = navigationBoundary(auth);
    setup.render(); await setup.ready(); setup.render();
    const route = auth.load("src/app/api/auth/session/route.ts"), actualGet = route.GET;
    const authorized = deferred<void>(), delivered = deferred<void>();
    let held = false;
    route.GET = async (request: Request) => {
      const response = await actualGet(request);
      if (!held) {
        held = true;
        assert.equal(response.status, 200);
        assert.equal((await response.clone().json()).user.role, "student");
        authorized.resolve(); await delivered.promise;
      }
      return response;
    };
    let advance: Promise<void> | undefined;
    if (path.startsWith("event")) setup.event("private-student-student", "retake-decision")({ action: path.endsWith("approval") ? "accept" : "reject", quizId: 44 });
    else {
      setup.queue("/api/quizzes", { body: { success: true, quizzes: [{ ...studentQuizzes.quizzes[0], attemptNumber: path.endsWith("approval") ? 2 : 1, quizStatus: path.endsWith("approval") ? "enrolled" : "completed" }] } });
      advance = setup.advance(5_000);
    }
    await authorized.promise; await login(auth, role);
    delivered.resolve(); await advance; await setup.ready();
    assert.equal(setup.pushes.length, 1);
    const actualNavigation = setup.pushes[0] === "reload" ? "/dashboard/student" : setup.pushes[0];
    const response = await boundary.navigate(actualNavigation);
    setup.unmount(); setup.assertDisposed();
    assert.equal(response.status, 307);
    assert.equal(new URL(response.headers.get("Location")!).pathname, "/login/student", "final navigation must fail closed instead of forwarding to the replacement portal");
    assert.equal(new URL(actualNavigation, "https://app.example.test").searchParams.get("_retakeStudent"), "student");
    assert.equal(response.headers.get("Cache-Control"), "private, no-store, max-age=0");
    assert.deepEqual(boundary.queries(), { userQueries: 0, quizQueries: 0 });
  });
}

for (const role of ["teacher", "admin"] as const) for (const path of ["/quiz/44", "/arena/44", "/dashboard/student"]) {
  test(`final Student-bound ${path} rejects ${role} before database/quiz access`, async () => {
    const auth = authFixture(); await login(auth, role); const boundary = navigationBoundary(auth);
    const response = await boundary.navigate(bound(path));
    assert.equal(response.status, 307);
    assert.equal(new URL(response.headers.get("Location")!).pathname, "/login/student");
    assert.equal(new URL(response.headers.get("Location")!).searchParams.has("_retakeStudent"), false);
    assert.deepEqual(boundary.queries(), { userQueries: 0, quizQueries: 0 });
  });
}

test("valid Student retake and Student rejection refresh pass the final boundary", async () => {
  const auth = authFixture(); await login(auth, "student"); const boundary = navigationBoundary(auth);
  assert.equal((await boundary.navigate(bound("/quiz/44"))).status, 200);
  assert.equal((await boundary.navigate(bound("/dashboard/student"))).status, 200);
  boundary.attempt({ ...approvedAttempt(), quizStatus: "in_progress", attemptMode: "arena", quiz: { quizMode: "arena", quizStatus: "ended" } });
  assert.equal((await boundary.navigate(bound("/arena/44"))).status, 200);
});

test("Arena event without a mode keeps the Student binding through its canonical redirect", async () => {
  const auth = authFixture(); await login(auth, "student");
  const setup = fixture("student", auth);
  const boundary = navigationBoundary(auth, { ...approvedAttempt(), attemptMode: "arena", quiz: { quizMode: "arena", quizStatus: "ended" } });
  setup.render(); await setup.ready(); setup.render();
  setup.event("private-student-student", "retake-decision")({ action: "accept", quizId: 44 });
  await setup.ready(); assert.deepEqual(setup.pushes, [bound("/quiz/44")]);
  const response = await boundary.navigate(setup.pushes[0]);
  assert.equal(response.status, 307);
  const target = new URL(response.headers.get("Location")!);
  assert.equal(target.pathname + target.search, bound("/arena/44"));
  assert.equal(response.headers.get("Cache-Control"), "private, no-store, max-age=0");
  assert.equal((await boundary.navigate(target.pathname + target.search)).status, 200);
  setup.unmount(); setup.assertDisposed();
});

for (const role of ["teacher", "admin"] as const) {
  test(`delayed canonical Arena redirect cannot adopt replacement ${role}`, async () => {
    const auth = authFixture(); await login(auth, "student");
    const boundary = navigationBoundary(auth, { ...approvedAttempt(), attemptMode: "arena", quiz: { quizMode: "arena", quizStatus: "ended" } });
    const heldRedirect = await boundary.navigate(bound("/quiz/44"));
    assert.equal(heldRedirect.status, 307);
    await login(auth, role);
    const target = new URL(heldRedirect.headers.get("Location")!);
    assert.equal(target.pathname + target.search, bound("/arena/44"));
    const before = boundary.queries();
    const response = await boundary.navigate(target.pathname + target.search);
    assert.equal(response.status, 307);
    assert.equal(new URL(response.headers.get("Location")!).pathname, "/login/student");
    assert.deepEqual(boundary.queries(), before);
  });
}

test("valid proctored retake arriving at Arena is canonicalized with its Student binding", async () => {
  const auth = authFixture(); await login(auth, "student"); const boundary = navigationBoundary(auth);
  const response = await boundary.navigate(bound("/arena/44"));
  assert.equal(response.status, 307);
  const target = new URL(response.headers.get("Location")!);
  assert.equal(target.pathname + target.search, bound("/quiz/44"));
  assert.equal((await boundary.navigate(target.pathname + target.search)).status, 200);
});

for (const path of paths) {
  test(`current Student ${path} reaches its legitimate final destination`, async () => {
    const auth = authFixture(); await login(auth, "student");
    const setup = fixture("student", auth), boundary = navigationBoundary(auth);
    setup.render(); await setup.ready(); setup.render();
    if (path.startsWith("event")) setup.event("private-student-student", "retake-decision")({ action: path.endsWith("approval") ? "accept" : "reject", quizId: 44 });
    else {
      setup.queue("/api/quizzes", { body: { success: true, quizzes: [{ ...studentQuizzes.quizzes[0], attemptNumber: path.endsWith("approval") ? 2 : 1, quizStatus: path.endsWith("approval") ? "enrolled" : "completed" }] } });
      await setup.advance(5_000);
    }
    await setup.ready();
    assert.deepEqual(setup.pushes, [bound(path.endsWith("approval") ? "/quiz/44" : "/dashboard/student")]);
    assert.equal((await boundary.navigate(setup.pushes[0])).status, 200);
    setup.unmount(); setup.assertDisposed();
  });
}

test("fresh Student remount after loss opens a legitimate Arena retake through the final boundary", async () => {
  const auth = authFixture(); await login(auth, "student"); const setup = fixture("student", auth);
  const boundary = navigationBoundary(auth, { ...approvedAttempt(), quizStatus: "in_progress", attemptMode: "arena", quiz: { quizMode: "arena", quizStatus: "ended" } });
  setup.render(); await setup.ready();
  const oldEvent = setup.event("private-student-student", "retake-decision");
  await login(auth, "teacher"); await setup.advance(5_000);
  assert.deepEqual(setup.resources(), { timers: 0, connected: 0, subscriptions: 0 });
  await login(auth, "student"); setup.remount(); await setup.ready();
  oldEvent({ action: "accept", quizId: 99 }); await setup.ready(); assert.deepEqual(setup.pushes, []);
  setup.event("private-student-student", "retake-decision")({ action: "accept", quizId: 44, quizMode: "arena" });
  await setup.ready(); assert.deepEqual(setup.pushes, [bound("/arena/44")]);
  assert.equal((await boundary.navigate(setup.pushes[0])).status, 200);
  setup.unmount(); setup.assertDisposed();
});

test("empty/duplicate identity markers and conflicting cookies cannot authorize navigation", async () => {
  const auth = authFixture(); await login(auth, "student"); const boundary = navigationBoundary(auth);
  for (const url of [bound("/quiz/44", ""), bound("/quiz/44") + "&_retakeStudent=student"]) {
    assert.equal(new URL((await boundary.navigate(url)).headers.get("Location")!).pathname, "/login/student");
  }
  auth.cookies.set("ps_session_admin", auth.token("admin"));
  assert.equal(new URL((await boundary.navigate(bound("/quiz/44"))).headers.get("Location")!).pathname, "/login/student");
  assert.deepEqual(boundary.queries(), { userQueries: 0, quizQueries: 0 });
});

for (const changed of ["missing", "another-owner", "first-attempt", "pending", "completed", "ended-attempt", "deleted-quiz", "wrong-mode"] as const) {
  test(`final Student retake rejects ${changed} rather than opening an ineligible attempt`, async () => {
    const auth = authFixture(); await login(auth, "student"); const attempt = approvedAttempt();
    if (changed === "another-owner") attempt.studentId = "other-student";
    if (changed === "first-attempt") attempt.attemptNumber = 1;
    if (changed === "pending") attempt.quizStatus = "pending_retake";
    if (changed === "completed") attempt.quizStatus = "completed";
    if (changed === "ended-attempt") attempt.endTime = new Date();
    if (changed === "deleted-quiz") attempt.quiz.quizStatus = "deleted";
    if (changed === "wrong-mode") attempt.attemptMode = "arena";
    const boundary = navigationBoundary(auth, changed === "missing" ? null : attempt);
    const response = await boundary.navigate(bound("/quiz/44"));
    assert.equal(response.status, 409);
    assert.equal(response.headers.has("Location"), false);
  });
}

for (const changed of ["different-student", "version", "suspended", "deleted", "role"] as const) {
  test(`final Student navigation fails closed for ${changed} identity`, async () => {
    const auth = authFixture(); await login(auth, "student"); const boundary = navigationBoundary(auth);
    const student = auth.users.get("student")!;
    if (changed === "version") student.sessionVersion++;
    if (changed === "suspended") student.status = "suspended";
    if (changed === "deleted") auth.users.delete("student");
    if (changed === "role") student.role.roleName = "teacher";
    const response = await boundary.navigate(bound("/quiz/44", changed === "different-student" ? "other-student" : "student"));
    assert.equal(response.status, 307);
    assert.equal(new URL(response.headers.get("Location")!).pathname, "/login/student");
    assert.equal(boundary.queries().quizQueries, 0);
  });
}

test("navigation database outage fails closed without redirecting to a role portal", async () => {
  const auth = authFixture(); await login(auth, "student"); const boundary = navigationBoundary(auth); boundary.failDatabase();
  const response = await boundary.navigate(bound("/quiz/44"));
  assert.equal(response.status, 503); assert.equal(response.headers.has("Location"), false);
});

test("unmarked Teacher and Admin listing/navigation keep their existing routing", async () => {
  const auth = authFixture(); const boundary = navigationBoundary(auth);
  for (const role of ["teacher", "admin"] as const) {
    await login(auth, role);
    assert.equal((await boundary.navigate(`/dashboard/${role}`)).status, 200);
  }
  await login(auth, "teacher");
  assert.equal(new URL((await boundary.navigate("/quiz/44")).headers.get("Location")!).pathname, "/dashboard/teacher");
  assert.deepEqual(boundary.queries(), { userQueries: 0, quizQueries: 0 });
});
