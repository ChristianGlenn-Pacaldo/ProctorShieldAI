import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as grading from "../src/lib/quiz-submission.ts";

const arenaSource = fs.readFileSync(path.resolve(process.cwd(), "src/app/arena/[id]/content.tsx"), "utf8");
const submitSource = fs.readFileSync(path.resolve(process.cwd(), "src/app/api/quizzes/submit/route.ts"), "utf8");
const arenaFile = ts.createSourceFile("content.tsx", arenaSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function finalizationCallback() {
  let callback: string | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "finalizeMatch"
      && node.initializer && ts.isCallExpression(node.initializer)) {
      callback = node.initializer.arguments[0]?.getText(arenaFile);
    }
    ts.forEachChild(node, visit);
  };
  visit(arenaFile);
  assert.ok(callback);
  const output = ts.transpileModule(`exports.finalizeMatch = ${callback};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return output;
}

type SubmitResponse = { ok: boolean; body: Record<string, unknown> } | "network-error" | "invalid-json";

function arenaFixture(responses: SubmitResponse[]) {
  const state = { phase: "in_wave", error: null as string | null, finalizing: false,
    submits: 0, rankings: 0, expEarned: null as number | null };
  const refs = {
    finalizationAttemptedRef: { current: false },
    finalizationInFlightRef: { current: false },
    finalizationConfirmedRef: { current: false },
    finalizationGenerationRef: { current: 0 },
  };
  const exports: { finalizeMatch?: (retry?: boolean) => Promise<void> } = {};
  vm.runInNewContext(finalizationCallback(), {
    exports,
    Error,
    ...refs,
    quizId: 46,
    currentSessionId: undefined,
    lockedAnswers: new Map([[101, { choiceId: 205, isCorrect: true }]]),
    fetch: async (url: string, options?: { body: string }) => {
      if (url.startsWith("/api/arena/")) return { ok: true, json: async () => ({ participants: [] }) };
      assert.equal(url, "/api/quizzes/submit");
      assert.deepEqual(JSON.parse(options!.body), { quizId: 46, answers: { 101: 205 } });
      state.submits++;
      const response = responses.shift();
      assert.ok(response);
      if (response === "network-error") throw new Error("connection lost");
      if (response === "invalid-json") return { ok: false, json: async () => { throw new SyntaxError("Invalid JSON"); } };
      return { ok: response.ok, json: async () => response.body };
    },
    setIncomingAttack() {}, setTargetPickerPower() {}, setIsLaunchingPower() {},
    setIsFinalizing(value: boolean) { state.finalizing = value; },
    setFinalizationError(value: string | null) { state.error = value; },
    setPhase(value: string) { state.phase = value; },
    setExpEarned(value: number) { state.expEarned = value; }, setStudentRank() {},
    updateRankingsFromParticipants() { state.rankings++; },
  });
  assert.ok(exports.finalizeMatch);
  assert.match(arenaSource, /if \(phase === "finalizing"\)[\s\S]*?role="alert"[\s\S]*?Retry Submission/);
  assert.match(arenaSource, /res\.status === 409 && errorData\?\.code === "ARENA_QUIZ_ALREADY_COMPLETED"[\s\S]*?finalizeMatchRef\.current\(\)/);
  return { state, refs, finalize: exports.finalizeMatch };
}

test("submit 500 keeps Arena in a retryable, unconfirmed state", async () => {
  const fixture = arenaFixture([{ ok: false, body: { error: "Submission failed" } }]);
  await fixture.finalize();
  assert.equal(fixture.state.phase, "finalizing");
  assert.equal(fixture.state.error, "Submission failed");
  assert.equal(fixture.state.finalizing, false);
  assert.equal(fixture.state.submits, 1);
  await fixture.finalize();
  assert.equal(fixture.state.submits, 1);
});

test("a non-JSON submit failure still shows a useful retry error", async () => {
  const fixture = arenaFixture(["invalid-json"]);
  await fixture.finalize();
  assert.equal(fixture.state.phase, "finalizing");
  assert.match(fixture.state.error || "", /Could not finalize/);
});

test("network failure keeps local answers and a retry succeeds once", async () => {
  const fixture = arenaFixture(["network-error", { ok: true, body: { success: true, result: { expEarned: 160 } } }]);
  await fixture.finalize();
  assert.equal(fixture.state.phase, "finalizing");
  assert.equal(fixture.state.error, "connection lost");
  await fixture.finalize(true);
  assert.equal(fixture.state.phase, "podium");
  assert.equal(fixture.state.error, null);
  assert.equal(fixture.state.submits, 2);
  assert.equal(fixture.state.expEarned, 160);
  await fixture.finalize(true);
  assert.equal(fixture.state.submits, 2);
});

test("normal successful submit shows podium after confirmation", async () => {
  const fixture = arenaFixture([{ ok: true, body: { success: true, result: { expEarned: 200 } } }]);
  await fixture.finalize();
  assert.equal(fixture.state.phase, "podium");
  assert.equal(fixture.refs.finalizationConfirmedRef.current, true);
  assert.equal(fixture.state.submits, 1);
  assert.equal(fixture.state.expEarned, 200);
});

test("simultaneous finalization calls issue one submit", async () => {
  const fixture = arenaFixture([{ ok: true, body: { success: true } }]);
  const first = fixture.finalize();
  const second = fixture.finalize();
  assert.equal(fixture.state.submits, 1);
  await Promise.all([first, second]);
  assert.equal(fixture.state.phase, "podium");
  assert.equal(fixture.state.submits, 1);
});

test("completed Arena attempt is reconciled idempotently without database writes", async () => {
  const routeCode = ts.transpileModule(submitSource, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  let writes = 0;
  let currentStudentId = "student-1";
  const studentQuiz = {
    id: "attempt-1", studentId: "student-1", quizId: 46, attemptMode: "arena",
    quizStatus: "completed", endTime: new Date(), score: 200,
    quiz: { quizStatus: "ended", quizMode: "arena" }, violations: [],
  };
  const prisma = {
    studentQuiz: { findFirst: async () => ({ ...studentQuiz, studentId: currentStudentId,
      score: currentStudentId === "student-1" ? 200 : 160 }) },
    $transaction: async () => { writes++; throw new Error("unexpected write"); },
  };
  const exports: { POST?: (request: Request) => Promise<Response> } = {};
  vm.runInNewContext(routeCode, {
    exports,
    require: (name: string) => {
      if (name === "@/lib/backup-write-gate") return { withBackupWriteGate: (handler: unknown) => handler };
      if (name === "next/server") return { NextResponse: { json: (body: unknown, options: { status?: number } = {}) =>
        new Response(JSON.stringify(body), { status: options.status ?? 200 }) } };
      if (name === "@/lib/prisma") return { __esModule: true, default: prisma };
      if (name === "@/lib/auth") return { getSession: async () => ({ userId: currentStudentId, role: "student" }) };
      if (name === "@/lib/arena") return { getArenaState: async () => ({ quizId: 46, sessionId: "session-1",
        participants: { "student-1": {}, "student-2": {} } }) };
      if (name === "@/lib/student-progression") return { getArenaExpAwarded: async (_sessionId: string, studentId: string) =>
        studentId === "student-1" ? 200 : 160 };
      return {};
    },
    console,
  });
  const request = () => new Request("http://localhost/api/quizzes/submit", {
    method: "POST", body: JSON.stringify({ quizId: 46, answers: { 101: 205 } }),
  });
  const first = await exports.POST!(request());
  const second = await exports.POST!(request());
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal((await first.json()).result.score, 200);
  assert.equal((await second.json()).result.expEarned, 200);
  currentStudentId = "student-2";
  const runnerUp = await exports.POST!(request());
  assert.equal(runnerUp.status, 200);
  assert.equal((await runnerUp.json()).result.expEarned, 160);
  assert.equal(writes, 0);
  studentQuiz.attemptMode = "proctored";
  const proctoredResponse = await exports.POST!(request());
  assert.equal(proctoredResponse.status, 409);
  assert.equal(writes, 0);
});

test("normal Arena completion returns a previously persisted award without granting it again", async () => {
  const routeCode = ts.transpileModule(submitSource, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  let completions = 0;
  let rewardWrites = 0;
  const attempt = {
    id: "attempt-3", studentId: "student-1", quizId: 46, attemptMode: "arena",
    quizStatus: "in_progress", startTime: new Date(), endTime: null,
    quiz: { id: 46, quizStatus: "in_progress", quizMode: "arena", duration: 30,
      teacherId: "teacher-1", title: "Arena" }, violations: [],
  };
  const tx = {
    studentQuiz: {
      updateMany: async () => ({ count: 1 }),
      update: async ({ data }: { data: Record<string, unknown> }) => { completions++; return { ...attempt, ...data }; },
    },
    answer: { findMany: async () => [], deleteMany: async () => {}, createMany: async () => {} },
    notification: { createMany: async () => {} },
  };
  const prisma = {
    studentQuiz: { findFirst: async () => attempt },
    question: { findMany: async () => [{ id: 101, points: 1, questionType: "multiple_choice",
      choices: [{ id: 205, isCorrect: true }, { id: 206, isCorrect: false }] }] },
    answer: { findMany: async () => [] },
    $transaction: async (operation: (client: typeof tx) => Promise<unknown>) => operation(tx),
  };
  const exports: { POST?: (request: Request) => Promise<Response> } = {};
  vm.runInNewContext(routeCode, {
    exports,
    require: (name: string) => {
      if (name === "@/lib/backup-write-gate") return { withBackupWriteGate: (handler: unknown) => handler };
      if (name === "next/server") return { NextResponse: { json: (body: unknown, options: { status?: number } = {}) =>
        new Response(JSON.stringify(body), { status: options.status ?? 200 }) } };
      if (name === "@/lib/prisma") return { __esModule: true, default: prisma };
      if (name === "@/lib/auth") return { getSession: async () => ({ userId: "student-1", role: "student", fullName: "Winner" }) };
      if (name === "@/lib/arena") return { getArenaState: async () => ({ quizId: 46, sessionId: "session-1", participants: { "student-1": {} } }), mutateArena: async (_quizId: number, operation: any) => prisma.$transaction((client: unknown) => operation({ tx: client, state: { sessionId: "session-1", participants: { "student-1": {} } } })) };
      if (name === "@/lib/student-progression") return { getArenaExpAwarded: async () => 200,
        awardStudentExp: async () => { rewardWrites++; throw new Error("unexpected reward"); } };
      if (name === "@/lib/quiz-submission") return grading;
      if (name === "@/lib/pusher") return { pusherServer: { trigger: async () => {} } };
      return {};
    },
    console,
    Date,
  });
  const response = await exports.POST!(new Request("http://localhost/api/quizzes/submit", {
    method: "POST", body: JSON.stringify({ quizId: 46, answers: { 101: 205 } }),
  }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).result.expEarned, 200);
  assert.equal(completions, 1);
  assert.equal(rewardWrites, 0);
});
