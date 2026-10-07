import assert from "node:assert/strict";
import test from "node:test";
import { NOW, reportAttempt, reportEvent, reportsRoute } from "./helpers/ai-reports-fixture.ts";

for (const role of ["student", "teacher"] as const) {
  test(role + " reports use original events instead of missing or stale AI totals", async () => {
    const events = [reportEvent(BigInt("9007199254740993"), "looking_left"), reportEvent(BigInt("9007199254740994"), "looking_left"),
      reportEvent(BigInt("9007199254740995"), "camera_unavailable"), reportEvent(BigInt("9007199254740996"), "historical_unknown")];
    const setup = reportsRoute(role, { attempts: [reportAttempt({ violations: events, quizStatus: "pending_retake" })] });
    const response = await setup.get();
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(body.totalViolations, 4);
    assert.equal(body.reports[0].violationCount, 4, "no three-strike display cap or stale analysis total");
    assert.equal(body.reports[0].aiAnalysis.totalViolations, 0, "original saved analysis remains unchanged");
    assert.equal(body.reports[0].analysisCurrent, false);
    assert.deepEqual(body.reports[0].violations.map((event: any) => event.id), events.map((event) => String(event.id)));
    assert.deepEqual(body.reports[0].violations.map((event: any) => event.violationType), events.map((event) => event.violationType));
    assert.ok(body.reports[0].violations.every((event: any) => event.timestamp === NOW.toISOString() && event.confidenceScore === 90 && event.durationSeconds === 4));
    assert.equal(body.reports[0].integrityInvalidated, true);
    assert.equal(body.reports[0].score, null);
    assert.equal(setup.queries.find((query) => query.model === "transaction").isolationLevel, "RepeatableRead");
  });
  test(role + " reports include unfinished recorded events and all retake attempts, but no empty unfinished or Arena report", async () => {
    const attempts = [
      reportAttempt(),
      reportAttempt({ id: "retake", attemptNumber: 2, quizStatus: "pending_retake" }),
      reportAttempt({ id: "active-events", endTime: null, quizStatus: "in_progress", violations: [reportEvent(BigInt("1"))] }),
      reportAttempt({ id: "active-empty", endTime: null, quizStatus: "in_progress" }),
      reportAttempt({ id: "rejected", quizStatus: "rejected" }),
      reportAttempt({ id: "inconsistent", endTime: null }),
      reportAttempt({ id: "arena", attemptMode: "arena" }),
      reportAttempt({ id: "foreign", studentId: "student-2", quiz: { id: 8, title: "Foreign", teacherId: "teacher-2" } }),
    ];
    const body = await (await reportsRoute(role, { attempts }).get()).json();
    assert.equal(body.totalReports, 3);
    assert.deepEqual(body.reports.map((report: any) => report.id).sort(), ["active-events", "attempt-1", "retake"]);
    const active = body.reports.find((report: any) => report.id === "active-events");
    assert.equal(active.isCompleted, false); assert.equal(active.analysisCurrent, false); assert.equal(active.integrityInvalidated, false);
    assert.equal(body.reports[0].student !== null, role === "teacher");
    assert.ok(!JSON.stringify(body).includes("never-expose"));
  });
  test(role + " pagination returns every event once, with stable timestamp and ID ties", async () => {
    const attempts = Array.from({ length: 43 }, (_, index) => {
      const id = "attempt-" + String(index).padStart(3, "0");
      return reportAttempt({ id, violations: [reportEvent(BigInt(index + 1), "tab_switch", { studentQuizId: id })] });
    });
    const setup = reportsRoute(role, { attempts });
    const pages = await Promise.all([1, 2, 3].map(async (page) => (await setup.get("?page=" + page)).json()));
    assert.deepEqual(pages.map((page) => page.reports.length), [20, 20, 3]);
    assert.ok(pages.every((page) => page.totalReports === 43 && page.totalViolations === 43));
    const ids = pages.flatMap((page) => page.reports.flatMap((report: any) => report.violations.map((event: any) => event.id)));
    assert.equal(ids.length, 43); assert.equal(new Set(ids).size, 43);
    assert.equal(pages[0].reports[0].id, "attempt-042");
    const beyond = await (await setup.get("?page=999")).json();
    assert.equal(beyond.page, 3); assert.equal(beyond.reports.length, 3);
  });
  test(role + " type filters retain complete attempt timelines and scope counts and search", async () => {
    const attempts = [
      reportAttempt({ violations: [reportEvent(BigInt("1"), "no_face"), reportEvent(BigInt("2"), "audio_anomaly")] }),
      reportAttempt({ id: "unknown", quiz: { id: 9, title: "Unknown", teacherId: "teacher-1" }, violations: [reportEvent(BigInt("3"), null)] }),
      reportAttempt({ id: "foreign", studentId: "student-2", quiz: { id: 10, title: "Foreign", teacherId: "teacher-2" }, violations: [reportEvent(BigInt("4"), "device_detected")] }),
    ];
    const setup = reportsRoute(role, { attempts });
    const filtered = await (await setup.get("?type=no_face&search=fixture")).json();
    assert.equal(filtered.totalReports, 1); assert.equal(filtered.totalViolations, 2);
    assert.equal(filtered.reports[0].violations.length, 2);
    assert.ok(!filtered.types.some((type: any) => type.value === "device_detected"));
    const unknown = await (await setup.get("?type=__untyped__")).json();
    assert.equal(unknown.totalReports, 1); assert.equal(unknown.reports[0].violations[0].violationType, null);
    const byStudent = await (await setup.get("?search=Fixture%20Student")).json();
    assert.equal(byStudent.totalReports, role === "teacher" ? 2 : 0);
  });
  test(role + " evidence references survive without exposing media keys or broadening replay authorization", async () => {
    const setup = reportsRoute(role, {
      attempts: [reportAttempt({ violations: [reportEvent(BigInt("100"), "no_face", { screenshotPath: "data:image/png;base64,private" })] })],
      evidence: [BigInt("1"), BigInt("2")].map((id) => ({ id, violationId: BigInt("100"), fileType: "video/webm", filePath: "private-storage-key", uploadedAt: NOW })),
    });
    const body = await (await setup.get()).json();
    const evidence = body.reports[0].violations[0].evidence;
    assert.equal(evidence.records.length, 2);
    assert.equal(evidence.hasLegacyEvidence, true);
    assert.equal(evidence.reviewUrl, role === "teacher" ? "/api/evidence/100" : null);
    assert.equal(evidence.metadataUnavailable, false);
    assert.ok(!JSON.stringify(body).includes("private-storage-key"));
    assert.ok(!JSON.stringify(body).includes("base64"));
    const unavailable = await (await reportsRoute(role, {
      attempts: [reportAttempt({ violations: [reportEvent(BigInt("100"))] })], evidenceFailure: true,
    }).get()).json();
    assert.equal(unavailable.totalViolations, 1); assert.equal(unavailable.reports[0].violations[0].evidence.metadataUnavailable, true);
  });
  test(role + " rejects invalid queries and wrong roles before reading report records", async () => {
    for (const query of ["?page=0", "?page=-1", "?page=1.5", "?page=NaN", "?page=9007199254740992", "?search=" + "x".repeat(121), "?type=" + "x".repeat(81)]) {
      assert.equal((await reportsRoute(role).get(query)).status, 400);
    }
    for (const session of [null, { role: role === "teacher" ? "student" : "teacher", userId: "foreign" }]) {
      const setup = reportsRoute(role, { session }); assert.equal((await setup.get()).status, 401); assert.equal(setup.queries.length, 0);
    }
    assert.equal((await reportsRoute(role, { databaseFailure: true }).get()).status, 500);
  });
}
test("Teacher report entitlement gate is preserved", async () => {
  const setup = reportsRoute("teacher", { pro: false });
  const response = await setup.get();
  assert.equal(response.status, 403); assert.equal((await response.json()).code, "SUBSCRIPTION_REQUIRED");
  assert.equal(setup.queries.length, 0);
});
test("Report refresh retrieves newly persisted events without rewriting existing identity", async () => {
  const attempt = reportAttempt();
  const setup = reportsRoute("student", { attempts: [attempt] });
  assert.equal((await (await setup.get()).json()).totalViolations, 0);
  attempt.violations.push(reportEvent(BigInt("99")));
  const refreshed = await (await setup.get()).json();
  assert.equal(refreshed.totalViolations, 1); assert.equal(refreshed.reports[0].violations[0].id, "99");
});
