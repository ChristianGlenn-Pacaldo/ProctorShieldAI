import assert from "node:assert/strict";
import test from "node:test";
import { deferred, find, fixture, studentQuizzes, teacherDashboard, textOf, type Reply } from "./helpers/dashboard-lifecycle-fixture.ts";

const resources = [
  { name: "quizzes", url: "/api/quizzes", error: "Could not load your quizzes.", loading: "Scanning for active missions", body: (label: string) => ({ success: true, quizzes: [{ ...studentQuizzes.quizzes[0], quiz: { ...studentQuizzes.quizzes[0].quiz, title: label } }] }) },
] as const;

async function prepare(resource: typeof resources[number]) {
  const setup = fixture("student");
  // The persistent retake consumer also reads quizzes at mount.
  if (resource.name === "quizzes") setup.queue(resource.url, { status: 500 });
  setup.queue(resource.url, { status: 500 });
  setup.render(); await setup.ready();
  const alert = find(setup.render(), n => n.props.role === "alert" && textOf(n).includes(resource.error))!;
  assert.ok(alert, "initial resource failure exposes the real Retry path");
  const retry = find(alert, n => n.type === "button" && textOf(n) === "Retry")!.props.onClick as () => void;
  return { setup, retry };
}

for (const resource of resources) {
  test(`Student ${resource.name}: exact older Retry success cannot replace newer data or loading/error state`, async () => {
    const { setup, retry } = await prepare(resource);
    const older = deferred<Reply>(); setup.queue(resource.url, older.promise); retry(); await setup.ready();
    setup.queue(resource.url, { body: resource.body("Newest committed data") }); retry(); await setup.ready();
    assert.match(textOf(setup.render()), /Newest committed data/);
    assert.doesNotMatch(textOf(setup.render()), /Could not load your|Loading progression|Scanning for active missions|Loading exam results/);
    const writes = setup.stateWriteCount();
    older.resolve({ body: resource.body("Older stale data") }); await setup.ready();
    assert.equal(setup.stateWriteCount(), writes, "superseded response/finally makes no React state writes");
    assert.match(textOf(setup.render()), /Newest committed data/);
    assert.doesNotMatch(textOf(setup.render()), /Older stale data|Could not load your/);
    setup.unmount(); setup.assertDisposed();
  });

  for (const failure of [{ status: 500 }, new Error("late network failure")]) {
    test(`Student ${resource.name}: older ${failure instanceof Error ? "network" : "HTTP"} failure cannot restore Retry after newer success`, async () => {
      const { setup, retry } = await prepare(resource);
      const older = deferred<Reply>(); setup.queue(resource.url, older.promise); retry(); await setup.ready();
      setup.queue(resource.url, { body: resource.body("Newest committed data") }); retry(); await setup.ready();
      const writes = setup.stateWriteCount(); older.resolve(failure); await setup.ready();
      assert.equal(setup.stateWriteCount(), writes);
      assert.match(textOf(setup.render()), /Newest committed data/);
      assert.doesNotMatch(textOf(setup.render()), /Could not load your|Retry/);
      setup.unmount(); setup.assertDisposed();
    });

    test(`Student ${resource.name}: older success cannot erase the newest ${failure instanceof Error ? "network" : "HTTP"} failure`, async () => {
      const { setup, retry } = await prepare(resource);
      const older = deferred<Reply>(); setup.queue(resource.url, older.promise); retry(); await setup.ready();
      setup.queue(resource.url, failure); retry(); await setup.ready();
      assert.ok(textOf(setup.render()).includes(resource.error));
      const writes = setup.stateWriteCount(); older.resolve({ body: resource.body("Older stale data") }); await setup.ready();
      assert.equal(setup.stateWriteCount(), writes);
      assert.ok(textOf(setup.render()).includes(resource.error));
      assert.doesNotMatch(textOf(setup.render()), /Older stale data/);
      setup.unmount(); setup.assertDisposed();
    });
  }

  test(`Student ${resource.name}: older finally cannot stop the newest in-flight loading state`, async () => {
    const { setup, retry } = await prepare(resource);
    const older = deferred<Reply>(), newer = deferred<Reply>();
    setup.queue(resource.url, older.promise); retry(); await setup.ready();
    setup.queue(resource.url, newer.promise); retry(); await setup.ready();
    assert.ok(textOf(setup.render()).includes(resource.loading));
    const writes = setup.stateWriteCount(); older.resolve({ status: 500 }); await setup.ready();
    assert.equal(setup.stateWriteCount(), writes);
    assert.ok(textOf(setup.render()).includes(resource.loading));
    newer.resolve({ body: resource.body("Newest committed data") }); await setup.ready();
    assert.match(textOf(setup.render()), /Newest committed data/);
    setup.unmount(); setup.assertDisposed();
  });

  test(`Student ${resource.name}: delayed JSON completion cannot overwrite a newer Retry`, async () => {
    const { setup, retry } = await prepare(resource);
    const body = deferred<unknown>(); setup.queue(resource.url, { body: body.promise }); retry(); await setup.ready();
    setup.queue(resource.url, { body: resource.body("Newest committed data") }); retry(); await setup.ready();
    const writes = setup.stateWriteCount(); body.resolve(resource.body("Older JSON data")); await setup.ready();
    assert.equal(setup.stateWriteCount(), writes);
    assert.match(textOf(setup.render()), /Newest committed data/);
    assert.doesNotMatch(textOf(setup.render()), /Older JSON data/);
    setup.unmount(); setup.assertDisposed();
  });

  test(`Student ${resource.name}: shared loss defeats both overlapping requests and old Retry callbacks`, async () => {
    const { setup, retry } = await prepare(resource);
    const older = deferred<Reply>(), newer = deferred<Reply>();
    setup.queue(resource.url, older.promise); retry(); await setup.ready();
    setup.queue(resource.url, newer.promise); retry(); await setup.ready();
    const pending = setup.requests.filter(r => r.url === resource.url && !r.settled);
    setup.queue("/api/notifications", { status: 401 }); setup.shellCallback("notification")(); await setup.ready(); setup.render();
    assert.ok(pending.every(r => r.signal?.aborted));
    const writes = setup.stateWriteCount(), requests = setup.requests.length;
    older.resolve({ body: resource.body("Old session A") }); newer.resolve({ body: resource.body("Old session B") });
    retry(); await setup.ready(); await setup.advance(35_000);
    assert.equal(setup.stateWriteCount(), writes); assert.equal(setup.requests.length, requests);
    assert.match(textOf(setup.render()), /session has expired or changed/);
    assert.doesNotMatch(textOf(setup.render()), /Old session|Retry/);
    setup.unmount(); setup.assertDisposed();
  });

  test(`Student ${resource.name}: fresh remount rejects both old-generation responses`, async () => {
    const { setup, retry } = await prepare(resource);
    const older = deferred<Reply>(), newer = deferred<Reply>();
    setup.queue(resource.url, older.promise); retry(); await setup.ready();
    setup.queue(resource.url, newer.promise); retry(); await setup.ready();
    setup.queue("/api/notifications", { status: 401 }); setup.shellCallback("notification")(); await setup.ready();
    if (resource.name === "quizzes") setup.queue(resource.url, { body: studentQuizzes });
    setup.queue(resource.url, { body: resource.body("Fresh session data") }); setup.remount(); await setup.ready();
    assert.match(textOf(setup.render()), /Fresh session data/);
    const writes = setup.stateWriteCount();
    older.resolve({ body: resource.body("Old session A") }); newer.resolve({ body: resource.body("Old session B") });
    await setup.ready();
    assert.equal(setup.stateWriteCount(), writes);
    assert.match(textOf(setup.render()), /Fresh session data/);
    assert.doesNotMatch(textOf(setup.render()), /Old session/);
    setup.unmount(); setup.assertDisposed();
  });

  test(`Student ${resource.name}: even a superseded 401 still invalidates shared authorization`, async () => {
    const { setup, retry } = await prepare(resource);
    const older = deferred<Reply>(); setup.queue(resource.url, older.promise); retry(); await setup.ready();
    setup.queue(resource.url, { body: resource.body("Newer active data") }); retry(); await setup.ready();
    older.resolve({ status: 401 }); await setup.ready();
    assert.match(textOf(setup.render()), /session has expired or changed/);
    assert.doesNotMatch(textOf(setup.render()), /Newer active data|Retry/);
    assert.deepEqual(setup.resources(), { timers: 0, connected: 0, subscriptions: 0 });
    setup.unmount(); setup.assertDisposed();
  });
}

test("Student latest empty quiz response remains authoritative over an older populated response", async () => {
  const { setup, retry } = await prepare(resources[0]);
  const older = deferred<Reply>(); setup.queue(resources[0].url, older.promise); retry(); await setup.ready();
  setup.queue(resources[0].url, { body: { success: true, quizzes: [] } }); retry(); await setup.ready();
  const writes = setup.stateWriteCount(); older.resolve({ body: resources[0].body("Older populated quiz") }); await setup.ready();
  assert.equal(setup.stateWriteCount(), writes);
  assert.doesNotMatch(textOf(setup.render()), /Older populated quiz|Could not load your quizzes/);
  assert.match(textOf(setup.render()), /All caught up/);
  setup.unmount(); setup.assertDisposed();
});

test("Student dashboard no longer requests the removed progression display", async () => {
  const setup = fixture("student"); setup.render(); await setup.ready();
  assert.equal(setup.requests.some(request => request.url === "/api/student/progression"), false);
  assert.doesNotMatch(textOf(setup.render()), /Level \d|Total EXP|AI Verified|Proctor Trust Index/);
  setup.unmount(); setup.assertDisposed();
});

test("Teacher sequencing retains the newest response after callback memoization", async () => {
  const setup = fixture("teacher"); setup.render(); await setup.ready();
  const joined = setup.event("private-teacher-teacher-id", "student-joined"), older = deferred<Reply>();
  setup.queue("/api/dashboard/teacher", older.promise); joined({ studentName: "A" }); await setup.ready();
  setup.queue("/api/dashboard/teacher", { body: { ...teacherDashboard, recentVerdicts: [{ ...teacherDashboard.recentVerdicts[0], name: "Newest Teacher result" }] } });
  joined({ studentName: "B" }); await setup.ready();
  const writes = setup.stateWriteCount(); older.resolve({ body: teacherDashboard }); await setup.ready();
  assert.equal(setup.stateWriteCount(), writes); assert.match(textOf(setup.render()), /Newest Teacher result/);
  setup.unmount(); setup.assertDisposed();
});

for (const role of ["teacher", "student"] as const) test(`${role} repeated renders do not restart initial fetch effects or realtime subscriptions`, async () => {
  const setup = fixture(role); setup.render(); await setup.ready();
  const count = setup.requests.length, resources = setup.resources(), endpoints = setup.authEndpoints();
  for (let i = 0; i < 5; i++) { setup.render(); await setup.ready(); }
  assert.equal(setup.requests.length, count); assert.deepEqual(setup.resources(), resources); assert.deepEqual(setup.authEndpoints(), endpoints);
  setup.unmount(); setup.assertDisposed();
});
