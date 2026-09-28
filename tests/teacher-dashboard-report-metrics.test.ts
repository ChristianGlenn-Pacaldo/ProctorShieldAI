import assert from "node:assert/strict";
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
      if (name === "@/lib/auth") return { getSession: async () => ({ role: "teacher", userId: "teacher-1" }) };
      if (name === "@/lib/maintenance") return { expireSubscriptions: async () => {} };
      if (name === "@/lib/teacher-entitlements") return { hasActiveProSubscription: async () => true };
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

test("Teacher dashboard labels lifetime distinct students and leaves live feed separate", () => {
  assert.match(dashboardContent, /label: "Unique Quiz Students"/);
  assert.match(dashboardContent, /sub: "All-time across your quizzes"/);
  assert.match(dashboardContent, /badge: "ALL-TIME"/);
  assert.doesNotMatch(dashboardContent, /sub: "Live Proctored Sessions"/);
  assert.match(dashboardContent, /channel\.bind\("student-joined", \(data: any\) => \{\s*fetchDashboardData\(\)/);
  assert.doesNotMatch(dashboardContent, /studentsMonitored: curr\.studentsMonitored \+ 1/);
  assert.doesNotMatch(dashboardContent, /flaggedStudents: curr\.flaggedStudents \+ 1/);
  assert.match(dashboardContent, /setLiveStudents\(\(prev\) => \{/);
});

test("Teacher reports categorize completed proctored attempts by violation count", async () => {
  const attempts = [0, 1, 2, 3, 4].map((count) => ({
    quizStatus: "completed",
    attemptMode: "proctored",
    endTime: new Date("2026-01-02"),
    violations: Array.from({ length: count }, () => ({ violationType: "tab_switch" })),
  }));
  attempts.push({ quizStatus: "completed", attemptMode: "arena", endTime: new Date("2026-01-02"), violations: [] });
  attempts.push({ quizStatus: "in_progress", attemptMode: "proctored", endTime: null as unknown as Date, violations: [] });
  const prisma = {
    studentQuiz: { findMany: async (query: { where: { quizStatus: string; endTime: { not: null }; attemptMode: string; quiz: { teacherId: string } } }) => {
      assert.equal(query.where.quizStatus, "completed");
      assert.equal(query.where.endTime.not, null);
      assert.equal(query.where.attemptMode, "proctored");
      assert.equal(query.where.quiz.teacherId, "teacher-1");
      return attempts.filter((attempt) => attempt.quizStatus === "completed" && attempt.endTime && attempt.attemptMode === "proctored");
    } },
  };
  const get = loadRoute(reportsRoutePath, prisma);
  const response = await get(new Request("http://localhost/api/dashboard/teacher/reports"));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body.data.map((bar: { label: string; value: number; pct: number }) => ({
    label: bar.label, value: bar.value, pct: bar.pct,
  })), [
    { label: "✓ Clean (0 violations)", value: 1, pct: 20 },
    { label: "⚠ Suspicious (1–2 violations)", value: 2, pct: 40 },
    { label: "🚫 High Risk (3+ violations)", value: 2, pct: 40 },
  ]);
  assert.match(reportsContent, /Completed proctored attempts are grouped by recorded violations/);
  assert.doesNotMatch(fs.readFileSync(reportsRoutePath, "utf8"), /Trust > 90%|70-90%|< 70%/);
});
