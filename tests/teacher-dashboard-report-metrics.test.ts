import { reportAttempt, reportEvent, reportsRoute } from "./helpers/ai-reports-fixture.ts";
import assert from "node:assert/strict";
import { fixture, find, textOf } from "./helpers/dashboard-lifecycle-fixture.ts";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const dashboardRoutePath = path.resolve(process.cwd(), "src/app/api/dashboard/teacher/route.ts");
const reportsRoutePath = path.resolve(process.cwd(), "src/app/api/dashboard/teacher/reports/route.ts");
const dashboardContent = fs.readFileSync(path.resolve(process.cwd(), "src/app/dashboard/teacher/content.tsx"), "utf8");
const reportsContent = fs.readFileSync(path.resolve(process.cwd(), "src/app/dashboard/teacher/reports/content.tsx"), "utf8");

function loadRoute(routePath: string, prisma: object) {
  const compiled = ts.transpileModule(fs.readFileSync(routePath, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const route: { GET?: (request: Request) => Promise<Response> } = {};
  vm.runInNewContext(compiled, {
    exports: route,
    require: (name: string) => {
      if (name === "next/server") return {
        NextResponse: { json: (body: unknown, options: { status?: number } = {}) =>
          new Response(JSON.stringify(body), { status: options.status ?? 200 }) },
      };
      if (name === "@/lib/prisma") return { __esModule: true, default: prisma };
      if (name === "@/lib/auth") return { getUserSession: async () => ({ role: "teacher", userId: "teacher-1" }) };
      if (name === "@/lib/maintenance") return { expireSubscriptions: async () => {} };
      if (name === "@/lib/teacher-entitlements") return { hasActiveProSubscription: async () => true };
      if (name === "@/lib/backup-write-gate" || name === "./backup-write-gate") return { withBackupWriteGate: (handler: unknown) => handler, runBackupWriteOrReject: (work: () => Promise<unknown>) => work(), runIncidentalBackupWrite: (work: () => Promise<unknown>) => work() };
      throw new Error(`Unexpected dependency: ${name}`);
    },
    console,
  }, { filename: routePath });
  return route.GET!;
}

test("Teacher dashboard counts distinct flagged students, not flagged attempts", async () => {
  const attempts = [
    { studentId: "student-1", aiVerdict: "suspicious", cheatingProbability: 35, violationTypes: ["tab_switch"] },
    { studentId: "student-1", aiVerdict: "cheated", cheatingProbability: 85, violationTypes: ["no_face", "tab_switch"] },
    { studentId: "student-2", aiVerdict: "clean", cheatingProbability: 10, violationTypes: [] },
    { studentId: "student-3", aiVerdict: "clean", cheatingProbability: 65, violationTypes: ["looking_away"] },
  ].map((attempt) => ({
    ...attempt,
    quizStatus: "completed",
    createdAt: new Date("2026-01-01"),
    endTime: new Date("2026-01-02"),
    student: { fullName: attempt.studentId },
    quiz: { title: "Fixture Quiz" },
    violations: attempt.violationTypes.map((violationType) => ({ violationType, timestamp: new Date("2026-01-02") })),
    score: 80,
  }));
  let queriedTeacherId: string | undefined;
  const prisma = {
    quiz: { count: async (query: { where: { teacherId: string } }) => {
      queriedTeacherId = query.where.teacherId;
      return 5;
    } },
    studentQuiz: { findMany: async (query: { where: { quiz: { teacherId: string } } }) => {
      assert.equal(query.where.quiz.teacherId, "teacher-1");
      return attempts;
    } },
  };
  const get = loadRoute(dashboardRoutePath, prisma);
  const response = await get(new Request("http://localhost/api/dashboard/teacher"));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(queriedTeacherId, "teacher-1");
  assert.equal(body.stats.totalQuizzes, 5);
  assert.equal(body.stats.studentsMonitored, 3);
  assert.equal(body.stats.totalViolations, 4);
  assert.equal(body.stats.flaggedStudents, 2);
  assert.equal(body.recentVerdicts.length, 4);
});

test("Teacher dashboard retains lifetime distinct counts without the redundant telemetry card", () => {
  assert.match(dashboardContent, /label: "Unique Quiz Students"/);
  assert.match(dashboardContent, /sub: "All-time across your quizzes"/);
  assert.match(dashboardContent, /badge: "ALL-TIME"/);
  assert.doesNotMatch(dashboardContent, /sub: "Live Proctored Sessions"/);
  assert.match(dashboardContent, /channel\.bind\("student-joined", \(\) => \{\s*if \(!work\.isCurrent\(generation\)\) return;\s*fetchDashboardData\(\)/);
  assert.doesNotMatch(dashboardContent, /studentsMonitored: curr\.studentsMonitored \+ 1/);
  assert.doesNotMatch(dashboardContent, /flaggedStudents: curr\.flaggedStudents \+ 1/);
  assert.doesNotMatch(dashboardContent, /Live Biometric Telemetry|RADAR ACTIVE|liveStudents|setLiveStudents/);
});

test("Teacher AI reports retain actual counts across completed and pending-retake proctored attempts", async () => {
  const attempts = [0, 1, 2, 3, 4].map((count, index) => reportAttempt({
    id: "attempt-" + index, violations: Array.from({ length: count }, (_, eventIndex) => reportEvent(BigInt(index * 10 + eventIndex + 1))),
  }));
  attempts.push(reportAttempt({ id: "retake", quizStatus: "pending_retake", violations: [reportEvent(BigInt("99"))] }));
  attempts.push(reportAttempt({ id: "arena", attemptMode: "arena" }));
  attempts.push(reportAttempt({ id: "active-empty", quizStatus: "in_progress", endTime: null }));
  const response = await reportsRoute("teacher", { attempts }).get();
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.totalReports, 6);
  assert.equal(body.totalViolations, 11);
  assert.deepEqual(body.reports.map((report: { violationCount: number }) => report.violationCount).sort((a: number, b: number) => a - b), [0, 1, 1, 2, 3, 4]);
  assert.match(reportsContent, /<AIReports role="teacher"/);
});

const scoreAttempt = (score: number | null, attemptMode: string, quizMode = attemptMode, aiVerdict = "clean") => ({
  studentId: "score-student", attemptMode, score, aiVerdict, cheatingProbability: 15,
  quizStatus: "completed", createdAt: new Date("2026-01-01"), endTime: new Date("2026-01-02"),
  student: { fullName: "Score Student" }, quiz: { title: "Score Fixture", quizMode },
  violations: [{ violationType: "tab_switch", timestamp: new Date("2026-01-02") }],
});

async function scoreDashboard(attempts: ReturnType<typeof scoreAttempt>[]) {
  const get = loadRoute(dashboardRoutePath, {
    quiz: { count: async () => 1 },
    studentQuiz: { findMany: async (query: { where: { quiz: { teacherId: string } } }) => {
      assert.equal(query.where.quiz.teacherId, "teacher-1");
      return attempts;
    } },
  });
  const response = await get(new Request("http://localhost/api/dashboard/teacher"));
  assert.equal(response.status, 200);
  return response.json();
}

for (const scenario of [
  { name: "Arena 213", score: 213, mode: "arena", expected: "213 pts" },
  { name: "proctored 85", score: 85, mode: "proctored", expected: "85%" },
  { name: "proctored zero", score: 0, mode: "proctored", expected: "0%" },
  { name: "Arena zero", score: 0, mode: "arena", expected: "0 pts" },
  { name: "missing proctored score", score: null, mode: "proctored", expected: "N/A" },
  { name: "missing Arena score", score: null, mode: "arena", expected: "N/A" },
  { name: "invalidated proctored score", score: 85, mode: "proctored", verdict: "cheated", expected: "Invalidated" },
  { name: "invalidated Arena score", score: 213, mode: "arena", verdict: "cheated", expected: "Invalidated" },
  { name: "invalidated missing score", score: null, mode: "proctored", verdict: "cheated", expected: "Invalidated" },
  { name: "historical Arena after quiz changes to proctored", score: 213, mode: "arena", currentMode: "proctored", expected: "213 pts" },
  { name: "historical proctored after quiz changes to Arena", score: 85, mode: "proctored", currentMode: "arena", expected: "85%" },
]) {
  test(`Teacher verdict score label: ${scenario.name}`, async () => {
    const attempt = scoreAttempt(scenario.score, scenario.mode, scenario.currentMode ?? scenario.mode, scenario.verdict);
    const body = await scoreDashboard([attempt]);
    assert.equal(body.recentVerdicts[0].score, scenario.expected);
    assert.equal(attempt.score, scenario.score, "formatting does not mutate the stored numeric score");
    assert.equal(attempt.attemptMode, scenario.mode);
    assert.deepEqual(body.recentVerdicts[0].violations, ["Tab ×1"]);
    assert.equal(body.stats.totalViolations, 1);
    assert.equal(body.recentVerdicts[0].verdict, scenario.verdict === "cheated" ? "🚫 Cheated (15%)" : "✓ Clean (15%)");
    assert.equal(body.recentVerdicts[0].verdictClass, scenario.verdict === "cheated" ? "bg-red-500/15 text-red-500" : "bg-emerald-500/15 text-emerald-600");
  });
}

test("Teacher mixed verdict scores retain their units through the actual Dashboard table", async () => {
  const attempts = [scoreAttempt(213, "arena", "proctored"), scoreAttempt(85, "proctored", "arena"),
    scoreAttempt(0, "arena"), scoreAttempt(0, "proctored"), scoreAttempt(null, "arena"),
    scoreAttempt(99, "proctored", "proctored", "cheated")];
  attempts[1].aiVerdict = "suspicious";
  const scoresBefore = attempts.map(attempt => attempt.score);
  const body = await scoreDashboard(attempts);
  const expected = ["213 pts", "85%", "0 pts", "0%", "N/A", "Invalidated"];
  assert.deepEqual(body.recentVerdicts.map((row: { score: string }) => row.score), expected);
  assert.equal(body.recentVerdicts[1].verdict, "⚠ Suspicious (15%)");
  assert.equal(body.recentVerdicts[1].verdictClass, "bg-amber-500/15 text-amber-500");
  assert.deepEqual(attempts.map(attempt => attempt.score), scoresBefore);
  const screen = fixture("teacher");
  screen.queue("/api/dashboard/teacher", { body });
  try {
    screen.render(); await screen.ready();
    const tree = screen.render();
    for (const label of expected) assert.ok(find(tree, node => node.type === "td" && textOf(node) === label), `table preserves ${label}`);
    assert.ok(!find(tree, node => node.type === "td" && textOf(node) === "213%"));
    assert.deepEqual(screen.errors, []);
  } finally { screen.unmount(); }
});
