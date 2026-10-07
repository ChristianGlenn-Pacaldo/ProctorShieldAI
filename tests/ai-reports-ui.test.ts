import assert from "node:assert/strict";
import test from "node:test";
import { NOW, nodesOf, reportCard, reportPayload, reportsPage, textOf } from "./helpers/ai-reports-fixture.ts";

const event = (id: string, overrides: Record<string, any> = {}) => ({
  id, studentQuizId: "attempt-1", violationType: "looking_left", label: "Looking left",
  timestamp: NOW.toISOString(), confidenceScore: 90, durationSeconds: 4,
  evidence: { records: [{ id: "media-" + id, fileType: "video/webm", uploadedAt: NOW.toISOString() }],
    hasLegacyEvidence: false, metadataUnavailable: false, reviewUrl: "/api/evidence/" + id },
  ...overrides,
});
for (const role of ["student", "teacher"] as const) {
  test(role + " renders every original event, exact time, evidence identity, and authoritative count", async () => {
    const card = reportCard({ violationCount: 2, violations: [event("100"), event("101")], analysisCurrent: false });
    const page = reportsPage(role, [{ ok: true, body: reportPayload({ reports: [card], totalReports: 1, totalViolations: 2 }) }]);
    await page.mount();
    const view = page.render();
    assert.match(textOf(view), /Violations: 2/);
    assert.match(textOf(view), /saved AI summary is outdated/);
    assert.doesNotMatch(textOf(view), /Cheated|Saved AI risk estimate|No recorded events/);
    assert.equal(nodesOf(view, (node) => node.type === "li").length, 2);
    assert.deepEqual(nodesOf(view, (node) => node.type === "li").map((node) => node.props["data-event-id"]), ["100", "101"]);
    assert.ok(nodesOf(view, (node) => node.type === "time").every((node) => node.props.dateTime === NOW.toISOString()));
    assert.match(textOf(view), /Evidence ID: media-100/);
    assert.equal(nodesOf(view, (node) => node.type === "a" && node.props.href.startsWith("/api/evidence/")).length, role === "teacher" ? 2 : 0);
    assert.equal(textOf(view).includes("Fixture Student"), role === "teacher");
    assert.equal(page.requests[0].cache, "no-store");
    page.unmount(); assert.equal(page.intervals(), 0);
  });
  test(role + " does not turn zero recorded events into a cheating verdict", async () => {
    const page = reportsPage(role, [{ ok: true, body: reportPayload({ reports: [reportCard({ aiVerdict: "cheated", cheatingProbability: 95 })], totalReports: 1 }) }]);
    await page.mount();
    assert.doesNotMatch(textOf(page.render()), /Cheated|Saved AI risk estimate/);
    assert.match(textOf(page.render()), /No monitoring events recorded/);
  });
  test(role + " failed refresh preserves events and Retry recovers without adding timers or duplicates", async () => {
    const body = reportPayload({ reports: [reportCard({ violationCount: 1, violations: [event("100")] })], totalReports: 1, totalViolations: 1 });
    const page = reportsPage(role, [{ ok: true, body }, { ok: false, status: 500 }, { ok: true, body }]);
    await page.mount(); await page.poll();
    assert.match(textOf(page.render()), /Could not load AI Reports/);
    assert.match(textOf(page.render()), /Event ID: 100/);
    await page.retry();
    assert.doesNotMatch(textOf(page.render()), /Could not load AI Reports/);
    assert.equal(nodesOf(page.render(), (node) => node.type === "li").length, 1);
    assert.equal(page.intervals(), 1); assert.equal(page.requestsCount(), 3);
  });
  test(role + " reports refresh after focus and pause polling while the page is hidden", async () => {
    const page = reportsPage(role, [{ ok: true, body: reportPayload() }, { ok: true, body: reportPayload({ totalViolations: 1 }) }]);
    await page.mount(); page.document.visibilityState = "hidden"; await page.poll();
    assert.equal(page.requestsCount(), 1);
    page.document.visibilityState = "visible"; await page.focus();
    assert.match(textOf(page.render()), /Recorded violations: 1/);
  });
  test(role + " page and filter changes ignore older pending responses", async () => {
    let resolveOld!: (value: any) => void;
    const pending = new Promise<any>((resolve) => { resolveOld = resolve; });
    const first = reportPayload({ reports: [reportCard()], totalReports: 21, pageCount: 2 });
    const second = reportPayload({ reports: [reportCard({ id: "page-2", quiz: { id: 8, title: "Second page" } })], page: 2, pageCount: 2, totalReports: 21 });
    const page = reportsPage(role, [{ ok: true, body: first }, pending, { ok: true, body: second }]);
    await page.mount(); await page.poll(); await page.click("Next");
    assert.equal(page.requests[1].signal?.aborted, true);
    assert.match(page.requests[2].url, /page=2/);
    resolveOld({ ok: true, body: first }); await page.settle();
    assert.match(textOf(page.render()), /Second page/);
    assert.doesNotMatch(textOf(page.render()), /Fixture Quiz/);
  });
  test(role + " applies search and type to the server, resets page, and Retry keeps the requested filters", async () => {
    const first = reportPayload({ reports: [reportCard()], types: [{ value: "looking_left", label: "Looking left" }], page: 2, pageCount: 2, totalReports: 21 });
    const page = reportsPage(role, [
      { ok: true, body: first }, { ok: false, status: 500 },
      { ok: true, body: reportPayload({ filters: { search: "biology", type: "looking_left" } }) },
    ]);
    await page.mount(); page.setSearch("biology"); await page.changeType("looking_left");
    assert.match(page.requests[1].url, /page=1.*search=biology.*type=looking_left/);
    await page.retry(); assert.equal(page.requests[1].url, page.requests[2].url);
    assert.match(textOf(page.render()), /Each timeline includes all events/);
    assert.match(textOf(page.render()), /No matching monitored quiz reports/);
  });
  test(role + " rejects malformed report responses and recovers through Retry", async () => {
    const page = reportsPage(role, [{ ok: true, body: { success: true, reports: [] } }, { ok: true, body: reportPayload() }]);
    await page.mount(); assert.match(textOf(page.render()), /Could not load AI Reports/);
    assert.doesNotMatch(textOf(page.render()), /No matching monitored quiz reports/);
    await page.retry(); assert.match(textOf(page.render()), /No matching monitored quiz reports/);
  });
  test(role + " stops report work on authorization loss and ignores a late success", async () => {
    let resolve!: (value: any) => void;
    const pending = new Promise<any>((done) => { resolve = done; });
    const page = reportsPage(role, [{ ok: true, body: reportPayload({ reports: [reportCard()], totalReports: 1 }) }, pending]);
    await page.mount(); await page.poll();
    page.channel.reportLoss(401);
    resolve({ ok: true, body: reportPayload({ reports: [reportCard()], totalReports: 1 }) }); await page.settle();
    assert.match(textOf(page.render()), /Sign in again/);
    assert.doesNotMatch(textOf(page.render()), /Fixture Quiz/);
    assert.equal(page.intervals(), 0);
    const count = page.requestsCount(); await page.focus(); await page.poll(); assert.equal(page.requestsCount(), count);
  });
  test(role + " unmount aborts pending report refresh and removes resource listeners", async () => {
    let resolve!: (value: any) => void;
    const page = reportsPage(role, [new Promise<any>((done) => { resolve = done; })]);
    await page.mount(); page.unmount();
    assert.equal(page.requests[0].signal?.aborted, true); assert.equal(page.intervals(), 0);
    resolve({ ok: true, body: reportPayload() }); await page.settle();
    await page.focus(); assert.equal(page.requestsCount(), 1);
  });
}
test("Teacher Pro restriction clears old reports and keeps the Billing action without treating it as session loss", async () => {
  const page = reportsPage("teacher", [
    { ok: true, body: reportPayload({ reports: [reportCard()], totalReports: 1 }) },
    { ok: false, status: 403, body: { code: "SUBSCRIPTION_REQUIRED" } },
  ]);
  await page.mount(); await page.poll();
  assert.match(textOf(page.render()), /AI Reports require an active Pro subscription/);
  assert.doesNotMatch(textOf(page.render()), /Fixture Quiz|Sign in again/);
  assert.equal(nodesOf(page.render(), (node) => node.props.href === "/dashboard/teacher/billing").length, 1);
});
test("Student and Teacher report cards use the same layout with role-specific identity and media controls", async () => {
  const body = reportPayload({ reports: [reportCard()], totalReports: 1 });
  const student = reportsPage("student", [{ ok: true, body }]), teacher = reportsPage("teacher", [{ ok: true, body }]);
  await student.mount(); await teacher.mount();
  assert.equal(nodesOf(student.render(), (node) => node.type === "article")[0].props.className,
    nodesOf(teacher.render(), (node) => node.type === "article")[0].props.className);
  assert.equal(nodesOf(student.render(), (node) => node.type === "h3")[0].props.children, "My AI Integrity Reports");
  assert.equal(nodesOf(teacher.render(), (node) => node.type === "h3")[0].props.children, "Class AI Integrity Reports");
});
