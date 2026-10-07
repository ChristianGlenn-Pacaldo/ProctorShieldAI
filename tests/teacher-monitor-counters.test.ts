import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const monitorPath = path.resolve(process.cwd(), "src/app/dashboard/teacher/monitor/content.tsx");
const snapshotPath = path.resolve(process.cwd(), "src/app/api/live/snapshot/route.ts");
const monitorSource = fs.readFileSync(monitorPath, "utf8");
const snapshotSource = fs.readFileSync(snapshotPath, "utf8");
const sourceFile = ts.createSourceFile(monitorPath, monitorSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

type Snapshot = { violationCount: number; connectionStatus: "online" | "offline" };
type Counters = { activeStudents: number; totalViolations: number };

function loadCounterDerivation() {
  const declaration = sourceFile.statements.find((statement): statement is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(statement) && statement.name?.text === "deriveMonitorCounters");
  assert.ok(declaration);
  const code = ts.transpileModule(`${declaration.getText(sourceFile)}\nexports.derive = deriveMonitorCounters;`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports: { derive?: (snapshots: Snapshot[]) => Counters } = {};
  vm.runInNewContext(code, { exports });
  assert.ok(exports.derive);
  return exports.derive;
}

const deriveCounters = loadCounterDerivation();

test("opening Monitor after existing violations shows snapshot totals", () => {
  const counters = deriveCounters([
    { violationCount: 2, connectionStatus: "online" },
    { violationCount: 1, connectionStatus: "offline" },
  ]);
  assert.equal(counters.totalViolations, 3);
  assert.equal(counters.activeStudents, 1);
  assert.match(snapshotSource, /_count: \{ select: \{ violations: true \} \}/);
  assert.match(snapshotSource, /violationCount: Math\.min\(3, attempt\._count\.violations\)/);
});

test("Active Students includes online snapshots but excludes offline snapshots", () => {
  const counters = deriveCounters([
    { violationCount: 0, connectionStatus: "online" },
    { violationCount: 0, connectionStatus: "offline" },
  ]);
  assert.equal(counters.activeStudents, 1);
  assert.equal(deriveCounters([{ violationCount: 0, connectionStatus: "offline" }]).activeStudents, 0);
  assert.match(snapshotSource, /connectionStatus: Date\.now\(\) - updatedAt < 30_000 \? "online" : "offline"/);
});

test("realtime violation followed by snapshot refresh cannot double-count", () => {
  const snapshot = [{ violationCount: 2, connectionStatus: "online" as const }];
  assert.equal(deriveCounters(snapshot).totalViolations, 2);
  assert.equal(deriveCounters(snapshot).totalViolations, 2);
  const violationHandler = monitorSource.slice(
    monitorSource.indexOf('teacherChannel.bind("new-violation"'),
    monitorSource.indexOf("    return () => {", monitorSource.indexOf('teacherChannel.bind("new-violation"')),
  );
  assert.doesNotMatch(violationHandler, /setMonitorCounters|setTotalViolations/);
  assert.match(monitorSource, /const nextCounters = deriveMonitorCounters\(snapshots\)/);
  assert.match(monitorSource, /current\.totalViolations === nextCounters\.totalViolations \? current : nextCounters/);
});

test("refresh and reopen derive the same counters from authoritative snapshots", () => {
  const snapshots = [
    { violationCount: 2, connectionStatus: "online" as const },
    { violationCount: 1, connectionStatus: "offline" as const },
  ];
  assert.deepEqual({ ...deriveCounters(snapshots) }, { activeStudents: 1, totalViolations: 3 });
  assert.deepEqual({ ...deriveCounters(snapshots) }, { activeStudents: 1, totalViolations: 3 });
  assert.deepEqual({ ...deriveCounters([]) }, { activeStudents: 0, totalViolations: 0 });
  assert.match(monitorSource, /\{monitorCounters\.activeStudents\}/);
  assert.match(monitorSource, /\{monitorCounters\.totalViolations\}/);
});

test("student feeds, evidence snapshots, and warning actions remain wired", () => {
  assert.match(monitorSource, /feeds\.map\(\(f\) => \(/);
  assert.match(monitorSource, /<StudentVideoFeed/);
  assert.match(monitorSource, /feed\.snapshot\.startsWith\("data:image\/"\)/);
  assert.match(monitorSource, /selectedStudentModal\.snapshot/);
  assert.match(monitorSource, /setFeeds\(\(prev\) => \{/);
  assert.match(monitorSource, /handleSendWarning/);
});


// Execute the feed route with filtered and ordered fixture records, including
// the stale ended attempt and equal attempt numbers observed in desktop QA.
import { loadArenaModule } from "./helpers/arena-fixture.ts";

function feedAttempt(id: string, quizId: number, startedMinutesAgo: number, attemptNumber = 1) {
  return { id, quizId, studentId: "student", attemptNumber, attemptMode: "proctored", quizStatus: "in_progress",
    startTime: new Date(Date.now() - startedMinutesAgo * 60_000), endTime: null,
    createdAt: new Date(Date.now() - (startedMinutesAgo + 1) * 60_000), lastHeartbeatAt: new Date(Date.now() - 1000),
    deviceType: "desktop", monitoringLevel: "strict", student: { fullName: "Student" }, _count: { violations: 2 },
    quiz: { teacherId: "teacher", quizMode: "proctored", quizStatus: "in_progress", title: id } };
}

async function readTeacherFeed(rows: any[]) {
  const matches = (row: any, where: any): boolean => Object.entries(where ?? {}).every(([key, value]: [string, any]) => {
    if (value && typeof value === "object" && !(value instanceof Date)) {
      if ("not" in value) return row[key] !== value.not;
      if ("notIn" in value) return !value.notIn.includes(row[key]);
      return matches(row[key], value);
    }
    return row[key] === value;
  });
  const route = loadArenaModule("src/app/api/live/snapshot/route.ts", {
    "next/server": { NextResponse: { json: (body: any, options: any = {}) => ({ status: options.status ?? 200, body }) } },
    "@/lib/auth": { getSession: async () => ({ userId: "teacher", role: "teacher" }) },
    "@/lib/backup-write-gate": { withBackupWriteGate: (handler: unknown) => handler },
    "@/lib/teacher-entitlements": { hasActiveProSubscription: async () => true },
    "@/lib/prisma": { __esModule: true, default: { studentQuiz: { findMany: async ({ where, orderBy }: any) => {
      const selected = rows.filter(row => matches(row, where));
      const orders = Array.isArray(orderBy) ? orderBy : [orderBy];
      return selected.sort((left, right) => {
        for (const order of orders) for (const [key, direction] of Object.entries(order)) {
          const compared = left[key] < right[key] ? -1 : left[key] > right[key] ? 1 : 0;
          if (compared) return compared * (direction === "desc" ? -1 : 1);
        }
        return 0;
      });
    } } } },
    "@/lib/snapshot-store": { saveSnapshot: async () => { throw Error("GET must not write snapshots"); },
      getSnapshotsForTeacher: async () => rows.map(row => ({ studentId: row.studentId, quizId: row.quizId,
        snapshot: "data:image/png;base64,fixture", updatedAt: Date.now() - 500 })) },
  });
  const response = await route.GET();
  assert.equal(response.status, 200);
  return response.body.snapshots as any[];
}

test("teacher feed excludes unfinished attempts belonging to ended quizzes", async () => {
  const stale = feedAttempt("stale-ended", 48, 120);
  stale.quiz.quizStatus = "ended";
  const snapshots = await readTeacherFeed([stale]);
  assert.equal(snapshots.length, 0, "an ended quiz must not retain an active teacher feed row");
});

test("teacher feed consistently selects the most recently started quiz when first-attempt numbers tie", async () => {
  const older = feedAttempt("older-first", 48, 120), current = feedAttempt("current-first", 51, 2);
  for (const rows of [[older, current], [current, older]]) {
    const snapshots = await readTeacherFeed(rows);
    assert.equal(snapshots.length, 1);
    assert.equal(snapshots[0].studentQuizId, current.id);
    assert.equal(snapshots[0].quizId, 51);
    assert.equal(snapshots[0].connectionStatus, "online");
    assert.equal(snapshots[0].snapshot, "data:image/png;base64,fixture");
    assert.equal(snapshots[0].violationCount, 2);
  }
});

test("an older quiz's higher attempt number does not hide the current live quiz", async () => {
  const older = feedAttempt("older-third", 48, 120, 3), current = feedAttempt("current-first", 51, 2);
  const snapshots = await readTeacherFeed([older, current]);
  assert.equal(snapshots[0].studentQuizId, current.id);
});

test("current teacher feed retains student isolation and excludes unstarted, submitted and Arena attempts", async () => {
  const current = feedAttempt("current", 51, 2);
  const otherTeacher = feedAttempt("other-teacher", 52, 1); otherTeacher.quiz.teacherId = "other";
  const arena = feedAttempt("arena", 53, 1); arena.quiz.quizMode = "arena"; arena.attemptMode = "arena";
  const unstarted = { ...feedAttempt("unstarted", 54, 1), startTime: null };
  const submitted = { ...feedAttempt("submitted", 55, 1), endTime: new Date() };
  const snapshots = await readTeacherFeed([otherTeacher, arena, unstarted, submitted, current]);
  assert.deepEqual(Array.from(snapshots, row => row.studentQuizId), [current.id]);
});
