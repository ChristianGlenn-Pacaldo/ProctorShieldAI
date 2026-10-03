import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import { execFileSync } from "node:child_process";
import ts from "typescript";
import { withRetakeEligibility } from "../src/lib/retake-eligibility.ts";
import { authFixture } from "./helpers/auth-fixture.ts";
import { deferred, fixture, studentQuizzes, textOf, type Reply } from "./helpers/dashboard-lifecycle-fixture.ts";

const studentUrl = "/api/quizzes?scope=user&role=student";
const sessionUrl = "/api/auth/session?scope=user&role=student";
const approved = { success: true, quizzes: [{ ...studentQuizzes.quizzes[0], attemptNumber: 2, quizStatus: "enrolled" }] };
const rejected = { success: true, quizzes: [{ ...studentQuizzes.quizzes[0], quizStatus: "completed" }] };

// Execute the actual quiz GET and session/cookie readers against the existing
// in-memory auth fixture. No configured DB, credentials or provider calls.
function quizApi(auth: ReturnType<typeof authFixture>) {
  let queries = 0;
  const studentQuiz = { findMany: async (query: { where: { studentId?: string } }) => {
    queries++;
    return query.where.studentId ? structuredClone(studentQuizzes.quizzes) : [];
  } };
  const dependencies: Record<string, unknown> = {
    "next/server": { NextResponse: { json: Response.json } },
    "@/lib/auth": auth.auth,
    "@/lib/prisma": { __esModule: true, default: {
      studentQuiz,
      quiz: { findMany: async () => { queries++; return [{ id: 44, quizStatus: "in_progress" }]; } },
    } },
    "node:crypto": {},
    "@/lib/backup-write-gate": { withBackupWriteGate: (handler: unknown) => handler },
    "@/lib/teacher-entitlements": { getTeacherEntitlements: async () => ({ studentLimitPerQuiz: 99 }) },
    "@/lib/subscription-rules": {},
    "@/lib/quiz-mode": {},
    "@/lib/quiz-availability": { UNAVAILABLE_QUIZ_STATUSES: ["deleted"] },
    "@/lib/ai-quiz-provenance": {},
    "@/lib/retake-eligibility": { withRetakeEligibility },
  };
  const route = {} as { GET: (request: Request) => Promise<Response> };
  const compiled = ts.transpileModule(fs.readFileSync("src/app/api/quizzes/route.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(compiled, { exports: route, require: (name: string) => {
    if (!(name in dependencies)) throw new Error(`Unexpected dependency: ${name}`);
    return dependencies[name];
  }, URL, console: { error() {} } });
  return { get: route.GET, queries: () => queries };
}

async function login(auth: ReturnType<typeof authFixture>, role: "student" | "teacher" | "admin") {
  assert.equal((await auth.post("auth/login", { email: `${role}@example.test`, password: "FixturePassword123", role })).status, 200);
}

async function setupStudent(retakeSource?: string) {
  const auth = authFixture(); await login(auth, "student");
  const api = quizApi(auth);
  const setup = fixture("student", auth, { quizGet: api.get, retakeSource });
  setup.render(); await setup.ready(); setup.render();
  return { auth, api, setup };
}

function assertLost(setup: ReturnType<typeof fixture>) {
  assert.match(textOf(setup.render()), /session has expired or changed|no longer have access/);
  assert.deepEqual(setup.resources(), { timers: 0, connected: 0, subscriptions: 0 });
  assert.deepEqual(setup.pushes, []);
}

test("deployed retake source reproduces reload when Teacher replaces a pending Student session", async () => {
  const oldSource = execFileSync("git", ["show", "017a57d18a6f6b2ce436b9fd18d709f4961644cc:src/app/dashboard/student/retake-redirect.tsx"], { encoding: "utf8" });
  const { auth, api, setup } = await setupStudent(oldSource);
  await login(auth, "teacher");
  const teacher = await api.get(new Request("https://app.example.test/api/quizzes"));
  assert.equal(teacher.status, 200);
  assert.equal((await teacher.json()).quizzes[0].quizStatus, "in_progress");
  await setup.advance(5_000); await setup.ready();
  assert.deepEqual(setup.pushes, ["reload"], JSON.stringify({requests:setup.requests.map(r=>({url:r.url,settled:r.settled})),errors:setup.errors.map(e=>e.map(String)),resources:setup.resources()}));
  setup.unmount(); setup.assertDisposed();
});

for (const role of ["teacher", "admin"] as const) {
  test(`Student-scoped quiz GET rejects ${role} replacement before quiz queries`, async () => {
    const auth = authFixture(); await login(auth, role);
    const api = quizApi(auth);
    const response = await api.get(new Request(`https://app.example.test${studentUrl}`));
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "Unauthorized" });
    assert.equal(api.queries(), 0);
  });

  test(`pending Student retake poll loses shared lifecycle after ${role} replacement without navigation`, async () => {
    const { auth, setup } = await setupStudent();
    const queued = setup.event("private-student-student", "retake-decision");
    await login(auth, role); await setup.advance(5_000); assertLost(setup);
    const count = setup.requests.length;
    queued({ action: "accept", quizId: 44 }); queued({ action: "reject", quizId: 44 });
    await setup.advance(35_000); assertLost(setup);
    assert.equal(setup.requests.length, count);
    setup.unmount(); setup.assertDisposed();
  });

  test(`old successful Student poll resolving after ${role} replacement is rejected by fresh identity check`, async () => {
    const { auth, setup } = await setupStudent();
    const old = deferred<Reply>(); setup.queue("/api/quizzes", old.promise); await setup.advance(5_000);
    await login(auth, role); old.resolve({ body: approved }); await setup.ready(); assertLost(setup);
    const count = setup.requests.length; await setup.advance(35_000);
    assert.equal(setup.requests.length, count); assertLost(setup);
    setup.unmount(); setup.assertDisposed();
  });

  for (const action of ["accept", "reject"] as const) {
    test(`realtime ${action} before confirmed loss cannot navigate under replacement ${role} session`, async () => {
      const { auth, setup } = await setupStudent();
      await login(auth, role);
      setup.event("private-student-student", "retake-decision")({ action, quizId: 44 });
      await setup.ready(); assertLost(setup);
      setup.unmount(); setup.assertDisposed();
    });
  }
}

test("Student-scoped GET preserves owned enrollments and legacy Teacher/Admin list behavior", async () => {
  const auth = authFixture(); await login(auth, "student"); const api = quizApi(auth);
  const student = await api.get(new Request(`https://app.example.test${studentUrl}`));
  assert.equal(student.status, 200);
  assert.equal((await student.json()).quizzes[0].quizStatus, "pending_retake");
  for (const role of ["teacher", "admin"] as const) {
    await login(auth, role);
    const response = await api.get(new Request("https://app.example.test/api/quizzes"));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).quizzes[0].id, 44);
  }
});

test("Student role cannot opt into the Admin session class through query parameters", async () => {
  const auth = authFixture(); await login(auth, "admin"); const api = quizApi(auth);
  const response = await api.get(new Request("https://app.example.test/api/quizzes?scope=admin&role=student"));
  assert.equal(response.status, 401); assert.equal(api.queries(), 0);
});

test("in-flight poll and identity responses cannot revive an already lost lifecycle", async () => {
  const { setup } = await setupStudent();
  const poll = deferred<Reply>(); setup.queue("/api/quizzes", poll.promise); await setup.advance(5_000);
  setup.queue("/api/notifications", { status: 401 }); setup.shellCallback("notification")(); await setup.ready(); assertLost(setup);
  const count = setup.requests.length;
  poll.resolve({ body: approved }); await setup.ready(); await setup.advance(35_000);
  assert.equal(setup.requests.length, count); assertLost(setup);
  setup.unmount(); setup.assertDisposed();
});

test("identity validation resolving after loss ignores both successful response and queued event", async () => {
  const { setup } = await setupStudent();
  const event = setup.event("private-student-student", "retake-decision");
  const identity = deferred<Reply>(); setup.queue("/api/auth/session", identity.promise);
  event({ action: "accept", quizId: 44 }); await setup.ready();
  const validation = setup.requests.at(-1)!; assert.equal(validation.url, sessionUrl);
  setup.queue("/api/notifications", { status: 401 }); setup.shellCallback("notification")(); await setup.ready(); assertLost(setup);
  assert.equal(validation.signal?.aborted, true);
  const count = setup.requests.length;
  identity.resolve({ body: { user: { userId: "student", role: "student" } } });
  event({ action: "reject", quizId: 44 }); await setup.ready(); await setup.advance(35_000);
  assert.equal(setup.requests.length, count); assertLost(setup);
  setup.unmount(); setup.assertDisposed();
});

test("HTTP 200 identity for another User cannot authorize stale Student retake navigation", async () => {
  const { setup } = await setupStudent();
  setup.queue("/api/auth/session", { body: { user: { userId: "another-student", role: "student" } } });
  setup.event("private-student-student", "retake-decision")({ action: "accept", quizId: 44 });
  await setup.ready(); assertLost(setup); setup.unmount(); setup.assertDisposed();
});

for (const role of ["teacher", "admin"] as const) {
  test(`HTTP 200 identity with ${role} role cannot authorize Student navigation`, async () => {
    const { setup } = await setupStudent();
    setup.queue("/api/auth/session", { body: { user: { userId: "student", role } } });
    setup.event("private-student-student", "retake-decision")({ action: "accept", quizId: 44 });
    await setup.ready(); assertLost(setup); setup.unmount(); setup.assertDisposed();
  });
}

test("initial identity validation outage retries without disabling valid retake reconciliation", async () => {
  const auth = authFixture(); await login(auth, "student"); const api = quizApi(auth);
  const setup = fixture("student", auth, { quizGet: api.get });
  setup.queue("/api/auth/session", { body: { user: { userId: "student", role: "student" } } });
  setup.queue("/api/auth/session", { status: 503 });
  setup.render(); await setup.ready(); assert.deepEqual(setup.pushes, []);
  await setup.advance(5_000);
  assert.equal(setup.requests.filter(request => request.url === studentUrl).length, 2);
  assert.equal(setup.bell().props.disabled, false);
  setup.queue("/api/quizzes", { body: approved }); await setup.advance(5_000);
  assert.deepEqual(setup.pushes, ["/quiz/44?_retakeStudent=student"]);
  setup.unmount(); setup.assertDisposed();
});

test("latest retake decision supersedes an older in-flight validation", async () => {
  const { setup } = await setupStudent();
  const first = deferred<Reply>(); setup.queue("/api/auth/session", first.promise);
  const event = setup.event("private-student-student", "retake-decision");
  event({ action: "accept", quizId: 44 }); await setup.ready();
  event({ action: "reject", quizId: 44 }); await setup.ready();
  first.resolve({ body: { user: { userId: "student", role: "student" } } }); await setup.ready();
  assert.deepEqual(setup.pushes, ["/dashboard/student?_retakeStudent=student"]);
  setup.unmount(); setup.assertDisposed();
});

for (const [body, destination] of [[approved, "/quiz/44?_retakeStudent=student"], [rejected, "/dashboard/student?_retakeStudent=student"]] as const) {
  test(`valid Student retake poll retains ${destination} behavior`, async () => {
    const { setup } = await setupStudent();
    setup.queue("/api/quizzes", { body }); await setup.advance(5_000);
    assert.deepEqual(setup.pushes, [destination]);
    assert.ok(setup.requests.some(request => request.url === studentUrl));
    setup.unmount(); setup.assertDisposed();
  });
}

test("fresh Student remount restores legitimate realtime retake and rejects callbacks from old generation", async () => {
  const { auth, setup } = await setupStudent();
  const oldEvent = setup.event("private-student-student", "retake-decision");
  await login(auth, "teacher"); await setup.advance(5_000); assertLost(setup);
  await login(auth, "student"); setup.remount(); await setup.ready(); setup.render();
  const count = setup.requests.length; oldEvent({ action: "accept", quizId: 99 }); await setup.ready();
  assert.equal(setup.requests.length, count); assert.deepEqual(setup.pushes, []);
  setup.event("private-student-student", "retake-decision")({ action: "accept", quizId: 44, quizMode: "arena" });
  await setup.ready(); assert.deepEqual(setup.pushes, ["/arena/44?_retakeStudent=student"]);
  setup.unmount(); setup.assertDisposed();
});
