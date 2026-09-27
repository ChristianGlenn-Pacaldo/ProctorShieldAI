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
