import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import ts from "typescript";
import vm from "node:vm";
import { arenaFixture, loadArenaModule } from "./helpers/arena-fixture.ts";

for (const minutes of [1, 10, 15, 45, 60, 120, 480]) {
  test(`Arena lobby and start use saved ${minutes} minutes despite stale launch settings`, async () => {
    const f = arenaFixture("lobby");
    f.data.quiz.duration = minutes;
    const lobby = await f.action("create_session", "teacher", { payload: { matchDuration: 1800 } });
    assert.equal(lobby.status, 200);
    assert.equal(lobby.body.arena.matchDuration, minutes * 60);
    const started = await f.action("start", "teacher", { payload: { matchDuration: 1800 } });
    assert.equal(started.status, 200);
    assert.equal(started.body.arena.matchDuration, minutes * 60);
    assert.ok(Math.abs(Date.parse(started.body.arena.matchEndsAt) - Date.parse(started.body.arena.startedAt) - minutes * 60_000) < 100);
    assert.equal((await f.restartRead()).matchDuration, minutes * 60);
    assert.equal(f.events.find(e => e.event === "arena-start")?.data.matchDuration, minutes * 60);
  });
}

for (const value of [0, -1, 1.5, 481, "bad", "", null, true, [], {}]) {
  test(`Arena rejects invalid explicit match duration: ${JSON.stringify(value)}`, async () => {
    const f = arenaFixture("lobby");
    f.data.quiz.duration = 45;
    const before = JSON.stringify(f.read());
    const response = await f.action("start", "teacher", { payload: { matchDuration: value } });
    assert.equal(response.status, 400);
    assert.equal(f.data.quiz.quizStatus, "active");
    assert.equal(JSON.stringify(f.read()), before);
  });
}

test("Arena start without a timer payload uses the saved value", async () => {
  const f = arenaFixture("lobby");
  f.data.quiz.duration = 45;
  assert.equal((await f.action("start")).body.arena.matchDuration, 2700);
});

function durationInputs() {
  const source = fs.readFileSync("src/components/teacher/proctorshield-quiz-editor.tsx", "utf8");
  const sf = ts.createSourceFile("editor.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const callbacks: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(sf) === "input" && node.getText(sf).includes("quizForm.duration}")) {
      const change = node.attributes.properties.find(p => ts.isJsxAttribute(p) && p.name.getText(sf) === "onChange") as ts.JsxAttribute;
      callbacks.push((change.initializer as ts.JsxExpression).expression!.getText(sf));
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return callbacks;
}

test("both duration inputs allow clearing and entering a replacement without a default reset", () => {
  const callbacks = durationInputs();
  assert.equal(callbacks.length, 2);
  for (const callback of callbacks) {
    let state: { duration: number } = { duration: 45 };
    const change = new Function("setQuizForm", "quizForm", `return (${callback})`)((next: typeof state) => { state = next; }, state);
    change({ target: { value: "" } });
    assert.ok(Number.isNaN(state.duration), "empty input must stay empty until corrected");
    change({ target: { value: "12" } });
    assert.equal(state.duration, 12);
    change({ target: { value: "1.5" } });
    assert.equal(state.duration, 1.5, "do not truncate invalid fractions into valid minutes");
  }
});

for (const minutes of [1, 15, 45, 480]) {
  test(`normal monitored start uses configured ${minutes} minutes`, async () => {
    const startTime = new Date();
    const attempt = { id: "a", quizId: 7, attemptMode: "proctored", quizStatus: "in_progress", startTime, endTime: null,
      attemptNumber: 1, monitoringLevel: "strict", quiz: { id: 7, quizMode: "proctored", quizStatus: "in_progress", duration: minutes, _count: { questions: 1 } } };
    const db: any = { $executeRaw: async () => {}, setting: { findUnique: async () => null },
      studentQuiz: { findFirst: async () => attempt, updateMany: async () => {}, findUnique: async () => attempt } };
    db.$transaction = async (work: (tx: any) => unknown) => work(db);
    const route = loadArenaModule("src/app/api/quizzes/session/route.ts", {
      "next/server": { NextResponse: { json: (body: any, options: any = {}) => ({ body, status: options.status ?? 200 }) } },
      "@prisma/client": {}, "@/lib/auth": { getSession: async () => ({ role: "student", userId: "s" }) },
      "@/lib/prisma": { __esModule: true, default: db },
      "@/lib/device-capabilities": {}, "@/lib/quiz-availability": { isQuizAvailable: () => true },
      "@/lib/backup-write-gate": { withBackupWriteGate: (handler: unknown) => handler },
    });
    const response = await route.POST({ json: async () => ({ action: "start", quizId: 7, studentQuizId: "a" }) });
    assert.equal(response.status, 200);
    assert.ok(response.body.remainingSeconds <= minutes * 60 && response.body.remainingSeconds >= minutes * 60 - 1);
  });
}

for (const minutes of [1, 15, 45, 480]) {
  test(`Arena duration edit persists and the next start uses ${minutes} minutes`, async () => {
    const f = arenaFixture("lobby");
    f.data.quiz.duration = 30;
    const edited = await f.editQuiz({ duration: minutes } as any);
    assert.equal(edited.status, 200);
    assert.equal(f.data.quiz.duration, minutes);
    const started = await f.action("start");
    assert.equal(started.body.arena.matchDuration, minutes * 60);
  });
}

test("host page reload takes saved duration instead of a URL override", async () => {
  const dependencies: Record<string, unknown> = {
    "react/jsx-runtime": { jsx: (type: unknown, props: any) => ({ type, props }) },
    "@/lib/auth": { getSession: async () => ({ role: "teacher", userId: "t" }) },
    "@/lib/teacher-entitlements": { getTeacherEntitlements: async () => ({ isSubscribed: true }) },
    "@/lib/prisma": { __esModule: true, default: { quiz: { findUnique: async () => ({ id: 7, teacherId: "t", quizMode: "arena", duration: 45, questions: [] }) } } },
    "next/navigation": { redirect: () => { throw Error("unexpected redirect"); }, notFound: () => { throw Error("unexpected notFound"); } },
    "./content": { __esModule: true, default: () => {} },
    "@/lib/arena": arenaFixture().arena,
  };
  const file = "src/app/dashboard/teacher/playground/arena/[id]/page.tsx";
  const code = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const page: any = {};
  vm.runInNewContext(code, { exports: page, require: (name: string) => {
    assert.ok(name in dependencies, `Unexpected import: ${name}`);
    return dependencies[name];
  } });
  for (const searchParams of [{}, { duration: "1800" }, { duration: "bad" }]) {
    const rendered = await page.default({ params: Promise.resolve({ id: "7" }), searchParams: Promise.resolve(searchParams) });
    assert.equal(rendered.props.matchDuration, 2700);
    assert.equal(rendered.props.quiz.duration, 2700);
  }
});

test("student Arena timer consumes the configured start deadline and duration", () => {
  const source = fs.readFileSync("src/app/arena/[id]/content.tsx", "utf8");
  const sf = ts.createSourceFile("student.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let handler: ts.Node | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(sf) === "arenaChannel.bind" && node.arguments[0]?.getText(sf) === '"arena-start"') handler = node.arguments[1];
    ts.forEachChild(node, visit);
  };
  visit(sf);
  assert.ok(handler);
  let seconds = 0;
  const compiled = ts.transpileModule(`module.exports = ${handler.getText(sf)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const callback = new Function("module", "finalizationAttemptedRef", "arenaCompletedRef", "setPhase", "setCurrentQuestionIndex", "setCurrentSessionId", "setMatchEndsAt", "setMatchTimeLeft", "updateRankingsFromParticipants", "getServerAdjustedNow", "serverTimeOffsetRef", compiled + "; return module.exports;")(
    {}, { current: false }, { current: false }, () => {}, () => {}, () => {}, () => {}, (value: number) => { seconds = value; }, () => {}, () => Date.now(), { current: 0 },
  );
  callback({ matchDuration: 900 });
  assert.equal(seconds, 900);
  callback({ matchDuration: 1800, matchEndsAt: new Date(Date.now() + 2700_000).toISOString() });
  assert.ok(seconds >= 2699 && seconds <= 2700);
});

for (const duration of [0, -1, 1.5, 481]) {
  test(`Arena rejects invalid stored duration ${duration}`, async () => {
    const f = arenaFixture("lobby");
    f.data.quiz.duration = duration;
    assert.equal((await f.action("start")).status, 400);
    assert.equal(f.data.quiz.quizStatus, "active");
  });
}
