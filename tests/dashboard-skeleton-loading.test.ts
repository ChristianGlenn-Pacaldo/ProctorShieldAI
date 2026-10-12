import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { dashboardLoadingFixture } from "./helpers/dashboard-loading-fixture.ts";
import { fixture, deferred, dashboard, studentQuizzes, teacherDashboard, textOf, find, type Reply } from "./helpers/dashboard-lifecycle-fixture.ts";

type Node = { type: unknown; props: Record<string, any> };
function nodes(value: any, predicate: (node: Node) => boolean): Node[] {
  if (Array.isArray(value)) return value.flatMap(child => nodes(child, predicate));
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  return [...(predicate(value) ? [value] : []), ...nodes(value.props.children, predicate)];
}
const shapes = (tree: unknown) => nodes(tree, node => node.props["aria-hidden"] === true && node.props.style?.borderRadius !== undefined);
const pending = (tree: unknown) => nodes(tree, node => node.props.role === "status" && /Scanning for active missions|Loading (Teacher|Admin) Dashboard/.test(textOf(node)));
const scenarios = [
  { role: "student", url: "/api/quizzes", body: studentQuizzes, empty: { success: true, quizzes: [] }, emptyText: /All caught up!/, privateText: /Private Student quiz/ },
  { role: "teacher", url: "/api/dashboard/teacher", body: teacherDashboard, empty: { ...teacherDashboard, stats: { totalQuizzes: 0, studentsMonitored: 0, totalViolations: 0, flaggedStudents: 0 }, recentVerdicts: [], violationsBreakdown: [] }, emptyText: /No recent quiz submissions/, privateText: /Private Teacher result/ },
  { role: "admin", url: "/api/dashboard/admin", body: dashboard, empty: { ...dashboard, stats: { totalUsers: 0, totalQuizzes: 0, totalViolations: 0, aiVerdictsToday: 0 }, users: [] }, emptyText: /No users registered yet/, privateText: /Privileged user row/ },
] as const;

function enqueueInitial(setup: ReturnType<typeof fixture>, scenario: typeof scenarios[number], reply: Reply | Promise<Reply>) {
  // The existing Student retake consumer and overview each fetch quizzes.
  if (scenario.role === "student") setup.queue(scenario.url, reply);
  setup.queue(scenario.url, reply);
}

for (const scenario of scenarios) {
  for (const empty of [false, true]) {
    test(`${scenario.role}: real pending fetch renders installed shapes and one status, then ${empty ? "empty" : "populated"} success removes them`, async () => {
      const setup = fixture(scenario.role), held = deferred<Reply>();
      enqueueInitial(setup, scenario, held.promise);
      setup.render(); await setup.ready();
      const loading = setup.render();
      assert.ok(shapes(loading).length > 0);
      assert.equal(pending(loading).length, 1);
      assert.ok(nodes(loading, n => n.props["aria-busy"] === true).length >= 3);
      assert.doesNotMatch(textOf(loading), scenario.privateText);
      assert.doesNotMatch(textOf(loading), scenario.emptyText);
      assert.ok(setup.requests.some(r => r.url === scenario.url && !r.settled));
      held.resolve({ body: empty ? scenario.empty : scenario.body }); await setup.ready();
      const loaded = setup.render();
      assert.equal(shapes(loaded).length, 0);
      assert.equal(pending(loaded).length, 0);
      assert.equal(nodes(loaded, n => n.props["aria-busy"] === true).length, 0);
      assert.match(textOf(loaded), empty ? scenario.emptyText : scenario.privateText);
      setup.unmount(); setup.assertDisposed();
    });
  }

  for (const reply of [{ status: 500 }, new Error("synthetic offline failure")]) {
    test(`${scenario.role}: ${reply instanceof Error ? "network" : "HTTP"} failure stops skeletons and real Retry recovers`, async () => {
      const setup = fixture(scenario.role);
      enqueueInitial(setup, scenario, reply); setup.render(); await setup.ready();
      const failed = setup.render();
      assert.equal(shapes(failed).length, 0);
      assert.equal(pending(failed).length, 0);
      assert.ok(find(failed, n => n.props.role === "alert" && textOf(n).includes("Could not load")));
      assert.doesNotMatch(textOf(failed), scenario.emptyText);
      setup.queue(scenario.url, { body: scenario.body }); setup.retry(); await setup.ready();
      assert.equal(shapes(setup.render()).length, 0);
      assert.match(textOf(setup.render()), scenario.privateText);
      setup.unmount(); setup.assertDisposed();
    });
  }

  for (const status of [401, 403]) {
    test(`${scenario.role}: pending ${status} replaces placeholders with the existing session-loss state`, async () => {
      const setup = fixture(scenario.role), held = deferred<Reply>();
      enqueueInitial(setup, scenario, held.promise); setup.render(); await setup.ready();
      assert.ok(shapes(setup.render()).length > 0);
      held.resolve({ status, body: { error: "Forbidden", secret: "must-not-render" } }); await setup.ready();
      const lost = setup.render();
      assert.equal(shapes(lost).length, 0);
      assert.equal(pending(lost).length, 0);
      assert.match(textOf(lost), /session has expired or changed|no longer have.*access/);
      assert.doesNotMatch(textOf(lost), /must-not-render|Retry/);
      const count = setup.requests.length; await setup.advance(35_000);
      assert.equal(setup.requests.length, count);
      setup.unmount(); setup.assertDisposed();
    });
  }
}

for (const scenario of scenarios.filter(s => s.role !== "student")) {
  test(`${scenario.role}: pending background refresh and Retry keep authorized zero values and empty states`, async () => {
    const setup = fixture(scenario.role);
    setup.queue(scenario.url, { body: scenario.empty }); setup.render(); await setup.ready(); setup.render();
    const emit = scenario.role === "teacher"
      ? setup.event("private-teacher-teacher-id", "student-submitted")
      : setup.event("private-admin-dashboard", "activity");
    setup.queue(scenario.url, { status: 500 }); emit({}); await setup.ready();
    const held = deferred<Reply>(); setup.queue(scenario.url, held.promise); setup.retry(); await setup.ready();
    const refreshing = setup.render();
    assert.equal(shapes(refreshing).length, 0);
    assert.equal(pending(refreshing).length, 0);
    assert.match(textOf(refreshing), scenario.emptyText);
    assert.ok(nodes(refreshing, n => n.type === "div" && textOf(n) === "0").length >= 4);
    held.resolve({ body: scenario.body }); await setup.ready();
    assert.match(textOf(setup.render()), scenario.privateText);
    setup.unmount(); setup.assertDisposed();
  });
}

test("Student: background requests retain authorized quizzes and out-of-order success cannot replace current data", async () => {
  const scenario = scenarios[0], setup = fixture("student");
  enqueueInitial(setup, scenario, { status: 500 }); setup.render(); await setup.ready();
  const retry = find(setup.render(), n => n.type === "button" && textOf(n) === "Retry")!.props.onClick;
  setup.queue(scenario.url, { body: studentQuizzes }); retry(); await setup.ready();
  const older = deferred<Reply>(), newest = deferred<Reply>();
  setup.queue(scenario.url, older.promise); retry(); await setup.ready();
  setup.queue(scenario.url, newest.promise); retry(); await setup.ready();
  assert.equal(shapes(setup.render()).length, 0);
  assert.equal(pending(setup.render()).length, 0);
  assert.match(textOf(setup.render()), /Private Student quiz/);
  newest.resolve({ body: studentQuizzes }); await setup.ready();
  const writes = setup.stateWriteCount();
  older.resolve({ body: scenario.empty }); await setup.ready();
  assert.equal(setup.stateWriteCount(), writes);
  assert.match(textOf(setup.render()), /Private Student quiz/);
  assert.equal(shapes(setup.render()).length, 0);
  setup.unmount(); setup.assertDisposed();
});

test("registry component preserves the original normal-motion animation and default timing", () => {
  const { registry } = dashboardLoadingFixture();
  const tree = registry.LoaderSkeleton({});
  const shimmer = nodes(tree, n => n.type === "motion-div")[0];
  assert.ok(shimmer);
  assert.deepEqual(Array.from(shimmer.props.animate.x), ["-100%", "100%"]);
  assert.equal(shimmer.props.transition.duration, 1.5);
  assert.equal(shimmer.props.transition.ease, "easeInOut");
  assert.equal(shimmer.props.transition.repeat, Infinity);
  assert.equal(tree.props["aria-hidden"], true);
});

test("reduced motion keeps static original shapes without mounting shimmer motion", () => {
  for (const reduced of [false, true]) {
    const { compositions } = dashboardLoadingFixture(reduced);
    for (const variant of ["quiz", "list", "chart", "table"]) {
      const tree = compositions.DashboardListSkeleton({ variant, count: 2 });
      assert.ok(shapes(tree).length > 0);
      assert.equal(String(tree.props["aria-hidden"]), "true");
      assert.equal(nodes(tree, n => n.props.role === "status").length, 0);
      assert.equal(nodes(tree, n => n.type === "button" || n.props.tabIndex !== undefined).length, 0);
      assert.equal(nodes(tree, n => n.type === "motion-div").length, reduced ? 0 : shapes(tree).length);
      for (const shape of shapes(tree)) {
        assert.equal(shape.props.style.backgroundColor, "var(--ps-surface-inset)");
      }
    }
  }
});

test("presentation CSS reserves responsive space, scales metrics with text, and hides SSR shimmer for reduced motion", () => {
  const css = fs.readFileSync("src/components/dashboard-loading.module.css", "utf8");
  assert.match(css, /animation:\s*reveal 0s 150ms both/);
  assert.match(css, /from \{ visibility: hidden; \}/);
  assert.match(css, /minmax\(0, 1fr\)/);
  assert.match(css, /height:\s*1em !important/);
  assert.match(css, /max-width:\s*100%/);
  assert.match(css, /prefers-reduced-motion: reduce[\s\S]*display: none/);
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b|white-space:\s*nowrap/);
});
