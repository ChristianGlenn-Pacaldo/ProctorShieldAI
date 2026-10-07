import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { acceptArenaRevision, claimArenaJoinFeedback, getArenaJoinKey } from "../src/lib/arena-feedback.ts";
import { isTerminalArenaSnapshot } from "../src/lib/arena-client-reconciliation.ts";
import { arenaFixture } from "./helpers/arena-fixture.ts";
import * as accessCode from "../src/lib/quiz-access-code.ts";
import * as quizJoin from "../src/lib/quiz-join.ts";
import * as quizMode from "../src/lib/quiz-mode.ts";
import * as availability from "../src/lib/quiz-availability.ts";
import * as capacity from "../src/lib/subscription-rules.ts";

const params = { params: Promise.resolve({ id: "77" }) };
function lateFixture() {
  const f = arenaFixture();
  f.data.quiz.duration = 47;
  Object.assign(f.data.quiz, { accessCode: "123456", teacher: { fullName: "Host" }, subject: { subjectName: "Math" } });
  const state = f.read();
  state.matchDuration = 47 * 60;
  state.startedAt = new Date(Date.now() - 36 * 60_000).toISOString();
  state.matchEndsAt = new Date(Date.now() + 11 * 60_000).toISOString();
  f.save(state);
  f.db.user = { findUnique: async () => ({ id: "late" }) };
  f.db.quiz.findFirst = async ({ where }: any) => where.accessCode === "123456" ? structuredClone(f.data.quiz) : null;
  f.db.notification = { create: async () => ({ id: "notice", createdAt: new Date() }) };
  const enrollment = (student = "late", role = "student") => f.load("quizzes/join", student, role, {
    "@/lib/security": { consumeRateLimitGroup: async () => ({ allowed: true }), getClientIp: () => "local" },
    "@/lib/quiz-access-code": accessCode, "@/lib/quiz-join": quizJoin, "@/lib/quiz-mode": quizMode,
    "@/lib/quiz-availability": availability, "@/lib/subscription-rules": capacity, "@/lib/student-identity": { getStudentInitials: () => "LS" },
  }).POST({ json: async () => ({ accessCode: "123456" }), headers: { get: () => null } });
  const snapshot = (student = "teacher", role = "teacher") => f.load("arena/[id]", student, role).GET({ nextUrl: { searchParams: new URLSearchParams("view=snapshot") } }, params);
  const enrolledLate = () => f.data.attempts.set("late", { id: "attempt-late", studentId: "late", quizId: 77, attemptNumber: 1, attemptMode: "arena", quizStatus: "enrolled", startTime: null, endTime: null });
  return { f, state, enrollment, snapshot, enrolledLate };
}

test("late PIN entry creates a playable Arena attempt and explicit entry registers the competitor", async () => {
  const { f, state, enrollment, snapshot } = lateFixture();
  assert.equal((await enrollment()).status, 201);
  const attempt = f.data.attempts.get("late");
  assert.equal(attempt.quizStatus, "in_progress");
  assert.equal(attempt.startTime.toISOString(), state.startedAt);
  assert.equal(f.read().participants.late, undefined, "PIN enrollment preserves explicit Arena membership");
  const joined = await f.action("join", "late");
  assert.equal(joined.status, 200);
  assert.equal(joined.body.arena.participants.late.isFinished, false);
  assert.equal(joined.body.arena.participants.late.score, 0);
  assert.equal(joined.body.arena.participants.late.questionsAnswered, 0);
  assert.equal(joined.body.arena.participants.late.totalQuestions, 2);
  assert.equal(joined.body.sessionId, state.sessionId);
  assert.equal(joined.body.arena.matchEndsAt, state.matchEndsAt);
  assert.ok(Math.abs((Date.parse(state.matchEndsAt) - joined.body.serverTime) / 1000 - 660) < 2);
  const host = await snapshot(); const peer = await snapshot("a", "student");
  assert.ok(host.body.participants.some((p: any) => p.studentId === "late"));
  assert.ok(peer.body.participants.some((p: any) => p.studentId === "late"));
  const event = f.events.find((e) => e.event === "arena-student-joined" && e.data.joinKind === "participant");
  assert.equal(event?.data.studentId, "late"); assert.equal(event?.data.sessionId, state.sessionId);
  assert.ok(event?.data.arenaRevision > (state.revision ?? 0));
  const scored = await f.answer("late");
  assert.equal(scored.status, 200); assert.equal(scored.body.score, 100);
  assert.equal(f.read().participants.late.questionsAnswered, 1);
  assert.equal((await f.answer("late", 2)).status, 200);
  assert.equal(f.read().participants.late.isFinished, true);
  assert.equal(f.read().participants.late.score, 200);
  assert.equal((await f.submit("late")).body.code, "ARENA_NOT_ENDED");
  assert.equal((await f.action("end")).status, 200);
  assert.equal((await f.submit("late")).status, 200);
  assert.equal(f.data.attempts.get("late").quizStatus, "completed");
});

test("a previously enrolled late entrant activates once at the original start and can answer", async () => {
  const { f, state, enrolledLate } = lateFixture(); enrolledLate();
  assert.equal((await f.action("join", "late")).status, 200);
  assert.equal(f.data.attempts.get("late").quizStatus, "in_progress");
  assert.equal(f.data.attempts.get("late").startTime.toISOString(), state.startedAt);
  assert.equal((await f.answer("late")).status, 200);
});

test("refresh, reconnect and concurrent duplicate joins preserve progress, attempts and everyone's deadline", async () => {
  const { f, state, enrollment } = lateFixture(); await enrollment();
  const attempts = f.data.attempts.size;
  const replies = await f.overlap(() => f.action("join", "late"), () => f.action("join", "late"));
  assert.ok(replies.every((r) => r.status === 200)); await f.answer("late");
  const progress = structuredClone(f.read().participants.late);
  const a = structuredClone(f.read().participants.a);
  await enrollment(); await f.action("join", "late");
  assert.deepEqual(f.read().participants.late, progress); assert.deepEqual(f.read().participants.a, a);
  assert.equal(f.data.attempts.size, attempts); assert.equal(Object.keys(f.read().participants).filter((id) => id === "late").length, 1);
  assert.equal(f.events.filter((e) => e.event === "arena-student-joined" && e.data.joinKind === "participant").length, 1);
  assert.equal(f.read().matchEndsAt, state.matchEndsAt); assert.equal(f.read().startedAt, state.startedAt); assert.equal(f.read().sessionId, state.sessionId);
});

for (const closed of ["expired", "ended"] as const) test(`${closed} Arena cannot enroll or activate a late competitor`, async () => {
  const { f, state, enrollment, enrolledLate } = lateFixture();
  if (closed === "expired") state.matchEndsAt = new Date(Date.now() - 1).toISOString();
  else { state.status = "ended"; state.finalizedAt = new Date().toISOString(); f.data.quiz.quizStatus = "ended"; }
  f.save(state);
  const joined = await enrollment(); assert.ok([403,409].includes(joined.status)); assert.equal(f.data.attempts.has("late"), false);
  enrolledLate(); assert.ok((await f.action("join", "late")).status >= 400);
  assert.equal(f.read().participants.late, undefined); assert.equal(f.read().matchEndsAt, state.matchEndsAt);
});

test("pending approval and rejected students cannot bypass registration authorization", async () => {
  for (const status of ["pending_approval", "rejected"]) {
    const { f, enrolledLate } = lateFixture(); enrolledLate(); f.data.attempts.get("late").quizStatus = status;
    assert.equal((await f.action("join", "late")).status, 404); assert.equal(f.read().participants.late, undefined);
  }
  const { enrollment } = lateFixture(); assert.equal((await enrollment("late", "teacher")).status, 401);
});

test("monitored late entry retains the existing teacher approval requirement", async () => {
  const { f, enrollment } = lateFixture(); f.data.quiz.quizMode = "proctored";
  const transaction = f.db.$transaction;
  f.db.$transaction = (operation: any) => transaction(async (tx: any) => {
    // The shared fixture's staged database needs its Arena lock before reads.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"arena-state:77"}))`;
    return operation(tx);
  });
  assert.equal((await enrollment()).status, 201);
  assert.equal(f.data.attempts.get("late").quizStatus, "pending_approval");
  assert.equal(f.data.attempts.get("late").startTime, null);
});

function clientCallback(file: string, name: string, context: Record<string, any>) {
  const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let declaration: ts.VariableDeclaration | undefined;
  const visit = (node: ts.Node) => { if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) declaration = node; ts.forEachChild(node, visit); };
  visit(source); assert.ok(declaration?.initializer);
  const init = declaration.initializer;
  const callback = ts.isCallExpression(init) && init.expression.getText(source) === "useCallback" ? init.arguments[0] : init;
  const exports: any = {};
  vm.runInNewContext(ts.transpileModule(`exports.callback=${callback.getText(source)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, { exports, Date, Map, Set, ...context });
  return exports.callback;
}

test("late membership event refreshes the real host Participants state without a manual refresh", async () => {
  const { f, enrollment, snapshot } = lateFixture(); await enrollment(); await f.action("join", "late");
  let battlers: any[] = []; let refresh: Promise<any> = Promise.resolve();
  const file = "src/app/dashboard/teacher/playground/arena/[id]/content.tsx";
  const context: Record<string, any> = {
    quiz: { id: 77, questions: [1,2] }, arenaSessionRef: { current: "session-1" }, arenaRevisionRef: { current: 0 },
    actionQuizRef: { current: 77 }, actionGenerationRef: { current: 0 }, terminalReconciledRef: { current: false }, displayedJoinFeedbackRef: { current: new Set() },
    acceptArenaRevision, isTerminalArenaSnapshot, claimArenaJoinFeedback, getArenaJoinKey, getStudentInitials: () => "LS",
    setBattlers: (update: any) => { battlers = update(battlers); }, setPhase() {}, setIsTimerRunning() {}, setMatchEndsAt() {}, setTimeLeft() {},
    playJoinChime() {}, setBattleEvents() {}, readRealtimeIdentity: () => ({ quizId: 77, sessionId: "session-1" }),
  };
  context.syncRankedBattlers = clientCallback(file, "syncRankedBattlers", context);
  const apply = clientCallback(file, "applyArenaSnapshot", context);
  context.reconciliationRef = { current: { hint: () => { refresh = snapshot().then((r: any) => apply(r.body)); } } };
  const joined = clientCallback(file, "handleStudentJoined", context);
  joined(f.events.find((e) => e.event === "arena-student-joined" && e.data.joinKind === "participant")!.data);
  await refresh; assert.ok(battlers.some((p) => p.id === "late")); assert.equal(battlers.length, 4);
});

test("the real student answer handler advances playable questions and reconciles earned points", async () => {
  const { f, enrollment } = lateFixture(); await enrollment(); await f.action("join", "late");
  const file = "src/app/arena/[id]/content.tsx"; let score = 0; let rank = 0; let completed = false;
  const context: Record<string, any> = {
    quizId: 77, studentId: "late", currentSessionId: "session-1", questions: [{ id: 1 }, { id: 2 }], currentQuestionIndex: 0,
    lockedAnswers: new Map(), isSubmittingAnswer: false, streak: 0, highestStreak: 0,
    questionWork: null, studentQuizId: "attempt-late", setQuestionWork: (work: any) => { context.questionWork = work; },
    captureGameplayAction: () => ({ isSameView: () => true, isCurrent: () => true }),
    readGameplayResponse: async (_url: string, options: any) => { const body = JSON.parse(options.body); const r = await f.answer("late", body.questionId); return { ok: r.status === 200, data: r.body }; },
    setSelectedChoice() {}, setIsSubmittingAnswer() {}, setErrorMessage: (error: any) => { assert.equal(error, null); },
    setLockedAnswers: (update: any) => { context.lockedAnswers = update(context.lockedAnswers); }, setAnswerFeedback() {}, playFeedbackChime() {},
    setStreak() {}, setHighestStreak() {}, setStudentRank: (n: number) => { rank = n; }, setTotalParticipants() {},
    setScore: (n: number) => { score = n; }, setRivals() {}, setAllParticipants() {}, setPodium() {}, getStudentInitials: () => "LS",
    scheduleGameplayCallback: (_action: any, work: any) => work(), setCurrentQuestionIndex: (update: any) => { context.currentQuestionIndex = update(context.currentQuestionIndex); },
    setQuestionsCompleted: (value: boolean) => { completed = value; }, refreshArenaState: () => assert.fail("valid late answers should succeed"),
  };
  context.updateRankingsFromParticipants = clientCallback(file, "updateRankingsFromParticipants", context);
  context.applyGameplayState = (data: any) => context.updateRankingsFromParticipants(data.participants);
  await clientCallback(file, "handleSelectChoice", context)(10);
  assert.equal(context.currentQuestionIndex, 1); assert.equal(score, 100); assert.equal(rank, 1);
  await clientCallback(file, "handleSelectChoice", context)(20);
  assert.equal(completed, true); assert.equal(score, 200); assert.equal(context.lockedAnswers.size, 2);
});

test("attempt activation and participant registration roll back together on failure", async () => {
  const { f, enrolledLate } = lateFixture(); enrolledLate(); f.fail("state");
  assert.equal((await f.action("join", "late")).status, 500);
  assert.equal(f.data.attempts.get("late").quizStatus, "enrolled"); assert.equal(f.data.attempts.get("late").startTime, null);
  assert.equal(f.read().participants.late, undefined); assert.equal(f.events.length, 0);
  assert.equal((await f.action("join", "late")).status, 200);
});

test("completed nonparticipants cannot be resurrected into competitors and stale session joins are rejected", async () => {
  const { f, enrolledLate, state } = lateFixture(); enrolledLate();
  Object.assign(f.data.attempts.get("late"), { quizStatus: "completed", endTime: new Date() });
  assert.equal((await f.action("join", "late")).status, 409); assert.equal(f.read().participants.late, undefined);
  assert.equal((await f.action("join", "a", { sessionId: "old" })).status, 409);
  assert.equal(f.read().sessionId, state.sessionId); assert.equal(f.read().matchEndsAt, state.matchEndsAt);
});

test("a late competitor is eligible for existing combat targeting rules", async () => {
  const { f, enrollment } = lateFixture(); await enrollment(); await f.action("join", "late");
  const launched = await f.attack("a", "meteor", { targetStudentId: "late" });
  assert.equal(launched.status, 200); assert.equal(f.read().pendingAttacks[launched.body.attackId].targetStudentId, "late");
});

test("simultaneous PIN enrollments create one attempt and only one registration event", async () => {
  const { f, enrollment } = lateFixture();
  const result = await f.overlap(() => enrollment(), () => enrollment());
  assert.deepEqual(result.map((r) => r.status), [201, 200]); assert.equal(f.data.attempts.size, 4);
  await f.overlap(() => f.action("join", "late"), () => f.action("join", "late"));
  assert.equal(f.events.filter((e) => e.event === "arena-student-joined" && e.data.joinKind === "participant").length, 1);
});

for (const flow of ["PIN enrollment", "participant entry"] as const) test(`expiry during ${flow} database reads cannot create an active late competitor`, async (t) => {
  const { f, state, enrollment, enrolledLate } = lateFixture();
  let now = Date.now(); t.mock.method(Date, "now", () => now);
  const transaction = f.db.$transaction;
  f.db.$transaction = (operation: any, options: any) => transaction(async (tx: any) => {
    const method = flow === "PIN enrollment" ? "findMany" : "findFirst";
    const original = tx.studentQuiz[method];
    tx.studentQuiz[method] = async (query: any) => {
      const result = await original(query);
      now = Date.parse(state.matchEndsAt) + 1;
      return result;
    };
    return operation(tx);
  }, options);
  if (flow === "PIN enrollment") {
    assert.equal((await enrollment()).status, 403); assert.equal(f.data.attempts.has("late"), false);
  } else {
    enrolledLate(); assert.equal((await f.action("join", "late")).status, 409);
    assert.equal(f.data.attempts.get("late").quizStatus, "enrolled");
  }
  assert.equal(f.read().participants.late, undefined); assert.equal(f.read().matchEndsAt, state.matchEndsAt);
});
