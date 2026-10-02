import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import crypto from "node:crypto";
import ts from "typescript";
import { spawnSync } from "node:child_process";
import { acceptArenaRevision, acceptArenaEventRevision, guardArenaChannel, claimArenaFeedback } from "../src/lib/arena-feedback.ts";
import { beginArenaGameplayAction, fetchArenaSnapshot, isTerminalArenaSnapshot, startArenaReconciliation, type ArenaSnapshot } from "../src/lib/arena-client-reconciliation.ts";
import { arenaFixture, loadArenaModule } from "./helpers/arena-fixture.ts";

const files = {
  teacher: ts.createSourceFile("teacher.tsx", fs.readFileSync("src/app/dashboard/teacher/playground/arena/[id]/content.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX),
  student: ts.createSourceFile("student.tsx", fs.readFileSync("src/app/arena/[id]/content.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX),
};
function find(kind: keyof typeof files, predicate: (node: ts.Node) => boolean) {
  const file = files[kind]; let found: ts.Node | undefined;
  const visit = (node: ts.Node) => { if (predicate(node)) found = node; ts.forEachChild(node, visit); };
  visit(file); assert.ok(found); return found;
}
function compile(kind: keyof typeof files, callback: ts.Node, context: Record<string, unknown>) {
  const exports: { callback?: (...args: any[]) => any } = {};
  vm.runInNewContext(ts.transpileModule(`exports.callback=${callback.getText(files[kind])};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, { exports, Date, Error, Map, ...context });
  return exports.callback!;
}
function callback(kind: keyof typeof files, name: string, context: Record<string, unknown>) {
  const declaration = find(kind, (node) => ts.isVariableDeclaration(node) && node.name.getText(files[kind]) === name) as ts.VariableDeclaration;
  return compile(kind, (declaration.initializer as ts.CallExpression).arguments[0], context);
}
function actionCallback(name: string, context: Record<string, unknown>) {
  const declaration = find("teacher", (node) => ts.isVariableDeclaration(node) && node.name.getText(files.teacher) === name) as ts.VariableDeclaration;
  return compile("teacher", declaration.initializer!, context);
}
const people = (score = 150) => [{ studentId: "a", studentName: "A", initials: "A", score, rank: 1 }, { studentId: "b", studentName: "B", initials: "B", score: 100, rank: 2 }]
  .map((p) => ({ ...p, questionsAnswered: 1, totalQuestions: 2, isFinished: false }));
const terminal = (revision = 11, score = 150): ArenaSnapshot => ({ success: true,
  quizId: 77, arena: { quizId: 77, status: "ended", finalizedAt: "2026-10-01T00:00:00Z", sessionId: "session", revision },
  sessionId: "session", participants: people(score), resultReady: true,
  result: { score, rank: 1, expEarned: 200 }, quizStatus: "ended",
} as unknown as ArenaSnapshot);
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

function client(kind: "teacher" | "student", completed = false) {
  const state = { phase: completed ? "finalizing" : "in_wave", score: 20, rank: 2, exp: 0,
    participants: people(20) as any[], podium: [] as any[], trace: [] as string[], error: null as string | null };
  const refs = {
    arenaRevisionRef: { current: 10 }, arenaSessionRef: { current: "session" }, snapshotSessionRef: { current: "session" },
    finalizationGenerationRef: { current: 0 }, finalizationConfirmedRef: { current: completed },
    finalizationAttemptedRef: { current: completed }, finalizationInFlightRef: { current: false },
    actionGenerationRef: { current: 0 }, terminalReconciledRef: { current: false }, actionQuizRef: { current: 77 },
    actionPendingRef: { current: false }, retryActionRef: { current: null },
    arenaCompletedRef: { current: completed }, terminalResultReconciledRef: { current: false },
    reconciliationRef: { current: null as ReturnType<typeof startArenaReconciliation> | null },
  };
  const context: Record<string, any> = { ...refs, acceptArenaRevision, acceptArenaEventRevision, isTerminalArenaSnapshot, startArenaReconciliation, fetchArenaSnapshot,
    beginArenaGameplayAction, clearGameplayTimers() {}, crypto, studentId: "a", quizId: 77, quiz: { id: 77, questions: [1, 2] }, isAlreadyEnded: completed,
    incomingAttackRef: { current: null }, serverTimeOffsetRef: { current: 0 }, lockedAnswers: new Map(),
    getStudentInitials: () => "A", clearIncomingAttack() {}, showAttackFeedback() {}, playFanfareSound() {},
    setTotalParticipants() {}, setRivals() {}, setAllParticipants() {}, setCurrentSessionId() {},
    setPhase(value: string) { state.trace.push("phase"); state.phase = value; },
    setScore(value: number) { state.score = value; }, setStudentRank(value: number) { state.rank = value; }, setExpEarned(value: number) { state.exp = value; },
    setPodium(value: any[]) { state.podium = value; state.trace.push("participants"); },
    setBattlers(update: (prev: any[]) => any[]) { state.participants = update(state.participants); state.trace.push("participants"); },
    setFinalizationError(value: string | null) { state.error = value; },
    setArenaCompleted() {},
    setIsActionPending() {}, setArenaError(value: string) { state.error = value; },
    setIsTimerRunning() {}, setMatchEndsAt() {}, setTimeLeft() {}, setIncomingAttack() {}, setTargetPickerPower() {},
    setIsSubmittingAnswer() {}, setIsLaunchingPower() {}, setIsFinalizing() {}, setMatchTimeLeft() {}, setEnabledPowers() {}, setUsedPowers() {}, setHasGuardianShield() {},
    setCurrentQuestionIndex() {}, setQuestionsCompleted() {}, setIsSpectating() {}, setSelectedChoice() {}, setAnswerFeedback() {}, setLockedAnswers() {}, setBattleLogs() {},
    finalizeMatch() { assert.fail("A result read must never invoke finalization"); },
  };
  context.readRealtimeIdentity = callback(kind, "readRealtimeIdentity", context);
  if (kind === "teacher") context.syncRankedBattlers = callback(kind, "syncRankedBattlers", context);
  else context.updateRankingsFromParticipants = callback(kind, "updateRankingsFromParticipants", context);
  return { state, refs, context, apply: callback(kind, "applyArenaSnapshot", context) };
}

test("Teacher dropped completion/score events: polling applies 150/100 before podium and corrects the winner", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] }); const f = client("teacher"); let reads = 0;
  const worker = startArenaReconciliation({ read: async () => ++reads === 1 ? { arena: { status: "active", revision: 10 } } as ArenaSnapshot : terminal(), apply: f.apply });
  t.after(() => worker.stop()); await flush(); t.mock.timers.tick(3_000); await flush();
  assert.equal(reads, 2); assert.equal(f.state.phase, "podium");
  assert.deepEqual(JSON.parse(JSON.stringify(f.state.participants.map((p) => [p.id, p.score]))), [["a", 150], ["b", 100]]);
  assert.ok(f.state.trace.lastIndexOf("participants") < f.state.trace.lastIndexOf("phase"));
  t.mock.timers.tick(30_000); await flush(); assert.equal(reads, 2);
});

test("Teacher arena-end applies its payload; a partial payload still receives independent PostgreSQL confirmation", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] }); const f = client("teacher"); let reads = 0;
  const bind = find("teacher", (node) => ts.isCallExpression(node) && node.expression.getText(files.teacher) === "arenaChannel.bind"
    && node.arguments[0]?.getText(files.teacher) === '"arena-end"') as ts.CallExpression;
  const worker = startArenaReconciliation({ read: async () => { reads++; if (reads === 1) throw Error(); return terminal(); }, apply: f.apply });
  f.refs.reconciliationRef.current = worker; t.after(() => worker.stop()); await flush();
  compile("teacher", bind.arguments[1], f.context)({ quizId: 77, sessionId: "session", arenaRevision: 10, participants: people(130) });
  assert.equal(f.state.participants[0].score, 130); await flush();
  assert.equal(f.state.participants[0].score, 150); assert.equal(reads, 2);
});

for (const kind of ["teacher", "student"] as const) test(`${kind} first terminal read fails; retry converges without a finalization call`, async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] }); const f = client(kind, true); let reads = 0;
  const worker = startArenaReconciliation({ read: async () => { if (++reads === 1) throw Error(); return terminal(); }, apply: f.apply });
  t.after(() => worker.stop()); await flush();
  assert.equal(f.refs.arenaCompletedRef.current, true); assert.equal(f.refs.terminalResultReconciledRef.current, false);
  t.mock.timers.tick(1_000); await flush(); assert.equal(reads, 2); assert.equal(f.state.phase, "podium");
  if (kind === "student") { assert.equal(f.state.score, 150); assert.equal(f.state.rank, 1); assert.equal(f.state.exp, 200); }
  else assert.equal(f.state.participants[0].score, 150);
});

test("Student submission updates personal authoritative score immediately; result read retries independently", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] }); const f = client("student"); let reads = 0, submits = 0;
  const worker = startArenaReconciliation({ read: async () => { if (++reads <= 2) throw Error(); return terminal(); }, apply: f.apply });
  f.refs.reconciliationRef.current = worker; t.after(() => worker.stop()); await flush();
  f.context.fetch = async (url: string) => { assert.equal(url, "/api/quizzes/submit"); submits++; return { ok: true, json: async () => ({ success: true, arenaRevision: 11, rank: 1, result: { score: 150, expEarned: 200 } }) }; };
  const finalize = callback("student", "finalizeMatch", f.context); await finalize(); await flush();
  assert.equal(f.state.score, 150); assert.equal(f.refs.finalizationConfirmedRef.current, true);
  assert.equal(f.refs.terminalResultReconciledRef.current, false);
  t.mock.timers.tick(2_000); await flush(); assert.equal(f.state.score, 150); assert.equal(f.state.phase, "podium");
  await finalize(true); assert.equal(submits, 1); assert.equal(reads, 3);
});

test("Student dropped completion and score events: an active poll discovers the final PostgreSQL result", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] }); const f = client("student"); let reads = 0;
  const worker = startArenaReconciliation({ read: async () => ++reads === 1 ? { arena: { status: "active", revision: 10 }, participants: people(20) } as ArenaSnapshot : terminal(), apply: f.apply });
  t.after(() => worker.stop()); await flush(); assert.equal(f.refs.arenaCompletedRef.current, false);
  t.mock.timers.tick(3_000); await flush();
  assert.equal(f.refs.arenaCompletedRef.current, true); assert.equal(f.refs.terminalResultReconciledRef.current, true);
  assert.equal(f.state.score, 150); assert.equal(f.state.podium[0].studentId, "a"); assert.equal(f.state.phase, "podium");
});

test("Student arena-end clears attacks and reads results without invoking a finalizer", () => {
  const f = client("student"); let refreshes = 0;
  f.refs.reconciliationRef.current = { refresh: async () => { refreshes++; }, hint() {}, stop() {} };
  const bind = find("student", (node) => ts.isCallExpression(node) && node.expression.getText(files.student) === "arenaChannel.bind"
    && node.arguments[0]?.getText(files.student) === '"arena-end"') as ts.CallExpression;
  compile("student", bind.arguments[1], f.context)({ participants: people() });
  assert.equal(f.refs.arenaCompletedRef.current, true); assert.equal(f.state.phase, "finalizing");
  assert.equal(f.state.score, 150); assert.equal(refreshes, 1);
});

for (const kind of ["teacher", "student"] as const) test(`${kind} stale response cannot overwrite a newer terminal snapshot`, () => {
  const f = client(kind); assert.equal(f.apply(terminal(12, 180)), true);
  assert.equal(f.apply(terminal(11, 150)), false);
  assert.equal(f.apply({ arena: { status: "active", revision: 10 }, participants: people(20) }), false);
  assert.equal(f.state.phase, "podium");
  assert.equal(kind === "student" ? f.state.score : f.state.participants[0].score, 180);
});

test("Student a newer session invalidates in-flight completion and rejects the old terminal response", () => {
  const f = client("student", true); f.refs.finalizationInFlightRef.current = true;
  f.apply({ arena: { status: "lobby", sessionId: "next-session", revision: 14 }, participants: [] } as unknown as ArenaSnapshot);
  assert.equal(f.refs.finalizationInFlightRef.current, false); assert.equal(f.refs.finalizationGenerationRef.current, 1);
  assert.equal(f.refs.arenaCompletedRef.current, false); assert.equal(f.state.phase, "lobby");
  assert.equal(f.apply(terminal(13)), false); assert.equal(f.state.phase, "lobby");
});

test("Student ended reload skips join/submission; actual effect reconnect reads persisted results with GET only", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] }); const f = client("student", true); const listeners = new Map<string, () => void>(); let reads = 0;
  f.context.applyArenaSnapshot = f.apply;
  f.context.window = f.context.document = { hidden: false, addEventListener(name: string, handler: () => void) { listeners.set(name, handler); }, removeEventListener(name: string) { listeners.delete(name); } };
  t.mock.method(globalThis, "fetch", async (url: string | URL | Request, options?: RequestInit) => {
    assert.equal(url, "/api/arena/77?view=snapshot"); assert.equal(options?.method, undefined); assert.equal(options?.cache, "no-store"); reads++;
    return { ok: true, json: async () => terminal() } as Response;
  });
  const join = find("student", (node) => ts.isCallExpression(node) && node.expression.getText(files.student) === "useEffect" && node.arguments[0]?.getText(files.student).includes("async function joinArena") === true) as ts.CallExpression;
  compile("student", join.arguments[0], f.context)(); assert.equal(reads, 0);
  const effect = find("student", (node) => ts.isCallExpression(node) && node.expression.getText(files.student) === "useEffect" && node.arguments[0]?.getText(files.student).includes("startArenaReconciliation(") === true) as ts.CallExpression;
  const cleanup = compile("student", effect.arguments[0], f.context)();
  try { await flush(); assert.equal(f.state.score, 150); assert.equal(reads, 1); listeners.get("online")!(); await flush(); assert.equal(reads, 2); }
  finally { cleanup(); }
  assert.equal(listeners.size, 0); t.mock.timers.tick(30_000); await flush(); assert.equal(reads, 2);
});

test("bounded backoff, one in-flight read, deadline cancellation and cleanup leave no polling handles", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] }); let reads = 0, aborted = 0;
  const worker = startArenaReconciliation({ read: (signal) => { reads++; return new Promise((_resolve, reject) => signal.addEventListener("abort", () => { aborted++; reject(Error()); })); }, apply: () => { assert.fail("Aborted read cannot apply"); } });
  await worker.refresh(); assert.equal(reads, 1); t.mock.timers.tick(5_000); await flush(); assert.equal(aborted, 1);
  t.mock.timers.tick(1_000); await flush(); assert.equal(reads, 2);
  worker.stop(); await flush(); assert.equal(aborted, 2);
  t.mock.timers.tick(60_000); await flush(); assert.equal(reads, 2);
});

test("unmounted late response cannot apply state; stopped reconciler does not keep a child process alive", async () => {
  let resolve!: (data: ArenaSnapshot) => void, applies = 0;
  const worker = startArenaReconciliation({ read: () => new Promise((ready) => { resolve = ready; }), apply: () => { applies++; return true; } });
  worker.stop(); resolve(terminal()); await flush(); assert.equal(applies, 0);
  const child = spawnSync(process.execPath, ["--input-type=module", "-e",
    "import {startArenaReconciliation} from './src/lib/arena-client-reconciliation.ts'; const worker=startArenaReconciliation({read:()=>new Promise(()=>{}),apply:()=>true});worker.stop();"],
  { cwd: process.cwd(), encoding: "utf8", timeout: 30_000 });
  assert.equal(child.error, undefined); assert.equal(child.status, 0);
});

test("read-only snapshot preserves rewards, EXP, completion, notifications and result events", async () => {
  const f = arenaFixture(); await f.answer("a"); await f.action("end");
  const serialize = (value: unknown) => JSON.stringify(value, (_key, item) => item instanceof Map ? [...item] : item);
  const before = serialize(f.data), events = f.events.length;
  const route = f.load("arena/[id]", "a");
  for (let i = 0; i < 3; i++) {
    const result = await route.GET({ nextUrl: { searchParams: new URLSearchParams({ view: "snapshot" }) } }, { params: Promise.resolve({ id: "77" }) });
    assert.equal(result.status, 200); assert.equal(result.body.resultReady, true); assert.equal(result.body.result.score, 100);
  }
  assert.equal(serialize(f.data), before); assert.equal(f.events.length, events);
  assert.equal((await f.load("arena/[id]", "foreign", "teacher").GET({ nextUrl: { searchParams: new URLSearchParams({ view: "snapshot" }) } }, { params: Promise.resolve({ id: "77" }) })).status, 404);
});

function teacherActions() {
  const f = client("teacher");
  let feedback = 0;
  Object.assign(f.context, { applyArenaSnapshot: f.apply, selectedMatchDuration: 1800, mode: "score_arena",
    enabledPowers: ["meteor", "shield"], playAirdropSound() { feedback++; }, playGongSound() { feedback++; },
    playFanfareSound() { feedback++; }, setBattleEvents() { feedback++; } });
  f.context.broadcastArenaAction = actionCallback("broadcastArenaAction", f.context);
  return { ...f, drop: actionCallback("handleDropAirdrop", f.context), start: actionCallback("handleStartMatch", f.context),
    end: actionCallback("handleEndArena", f.context), feedback: () => feedback };
}
function committedAction(revision = 11, score = 50, hasShield = true, sessionId = "session") {
  return { success: true, quizId: 77, sessionId, arena: { quizId: 77, status: "active", sessionId, revision },
    participants: people(score).map((p) => ({ ...p, hasShield })) };
}
function delayedResponse(f: ReturnType<typeof teacherActions>) {
  let release!: (body: unknown) => void;
  f.context.fetch = () => new Promise((resolve) => { release = (body) => resolve({ ok: true, json: async () => body }); });
  // Recompile to bind this request implementation to the actual callback.
  f.context.broadcastArenaAction = actionCallback("broadcastArenaAction", f.context);
  return { release: (body: unknown) => release(body),
    drop: actionCallback("handleDropAirdrop", f.context),
    start: actionCallback("handleStartMatch", f.context), end: actionCallback("handleEndArena", f.context) };
}
function finalTeacherSnapshot(reason = "timer_expiry", score = 50) {
  const data = terminal(12, score);
  data.arena!.completionReason = reason as "timer_expiry" | "teacher_end";
  data.participants = people(score).map((p) => ({ ...p, hasShield: false }));
  return data;
}

test("exact overlap: in-flight terminal read wins before airdrop continuation; 50 never becomes 100", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = teacherActions(); let release!: (data: ArenaSnapshot) => void, reads = 0;
  const worker = startArenaReconciliation({ read: () => { reads++; return new Promise((resolve) => { release = resolve; }); }, apply: f.apply });
  t.after(() => worker.stop());
  f.refs.reconciliationRef.current = { refresh() {
    const pending = worker.refresh(); // Already busy: cannot schedule a second read.
    release(finalTeacherSnapshot()); // This read finishes before caller's await continuation.
    return pending;
  }, hint: () => worker.hint(), stop: () => worker.stop() };
  const request = delayedResponse(f); const dropped = request.drop();
  request.release(committedAction()); await dropped; await flush();
  assert.equal(f.state.phase, "podium"); assert.equal(f.state.participants.find((p) => p.id === "a").score, 50);
  assert.equal(f.state.participants.find((p) => p.id === "a").hasShield, false);
  assert.equal(f.feedback(), 0); t.mock.timers.tick(30_000); await flush(); assert.equal(reads, 1);
});

for (const reason of ["timer_expiry", "teacher_end"]) test(`late airdrop HTTP response after ${reason} cannot replace terminal scores/ranks/shields`, async () => {
  const f = teacherActions(); const request = delayedResponse(f); const pending = request.drop();
  f.apply(finalTeacherSnapshot(reason)); const before = JSON.stringify(f.state.participants);
  request.release(committedAction()); await pending;
  assert.equal(JSON.stringify(f.state.participants), before); assert.equal(f.state.phase, "podium"); assert.equal(f.feedback(), 0);
});

test("normal airdrop uses committed score/protection instead of optimistic arithmetic", async () => {
  const f = teacherActions(); const request = delayedResponse(f); const pending = request.drop();
  // Deliberately not previous-score + 50: the server may have accepted concurrent combat.
  request.release(committedAction(11, 37, true)); await pending;
  assert.equal(f.state.participants.find((p) => p.id === "a").score, 37);
  assert.equal(f.state.participants.find((p) => p.id === "a").hasShield, true);
  assert.equal(f.state.phase, "wave"); assert.equal(f.feedback(), 2);
});

test("overlapping Teacher views: newer action revision wins; stale response cannot revert score/protection", async () => {
  const f = teacherActions(); const request = delayedResponse(f); const pending = request.drop();
  // Another Teacher view's action has committed while this view's request waits.
  const other = teacherActions(); const otherRequest = delayedResponse(other); const otherPending = otherRequest.drop();
  const newer = committedAction(12, 9, false);
  otherRequest.release(newer); await otherPending;
  f.apply(newer as unknown as ArenaSnapshot);
  request.release(committedAction(11, 50, true)); await pending;
  assert.equal(f.state.participants.find((p) => p.id === "a").score, 9);
  assert.equal(f.state.participants.find((p) => p.id === "a").hasShield, false); assert.equal(f.feedback(), 0);
});

test("one Teacher view prevents a duplicate in-flight action", async () => {
  const f = teacherActions(); let requests = 0;
  const request = delayedResponse(f); const transport = f.context.fetch;
  f.context.fetch = (...args: unknown[]) => { requests++; return transport(...args); };
  f.context.broadcastArenaAction = actionCallback("broadcastArenaAction", f.context);
  const drop = actionCallback("handleDropAirdrop", f.context);
  const pending = drop(); await drop(); assert.equal(requests, 1);
  request.release(committedAction()); await pending;
  assert.equal(f.state.participants.find((p) => p.id === "a").score, 50);
});

for (const name of ["start", "end"] as const) test(`normal ${name} applies authoritative phase and participants`, async () => {
  const f = teacherActions(); const request = delayedResponse(f); const pending = request[name]();
  const data = name === "end" ? { ...finalTeacherSnapshot(), success: true } : committedAction();
  request.release(data); await pending;
  assert.equal(f.state.phase, name === "end" ? "podium" : "wave");
  assert.equal(f.state.participants.find((p) => p.id === "a").score, 50); assert.equal(f.feedback(), 1);
});

for (const name of ["start", "end"] as const) test(`late ${name} continuation cannot replace a newer terminal/session phase`, async () => {
  const f = teacherActions(); const request = delayedResponse(f); const pending = request[name]();
  if (name === "start") f.apply(finalTeacherSnapshot());
  else f.apply({ arena: { status: "lobby", revision: 12, sessionId: "new-session" }, participants: [] } as unknown as ArenaSnapshot);
  const before = JSON.stringify(f.state);
  request.release(committedAction()); await pending;
  assert.equal(JSON.stringify(f.state), before); assert.equal(f.feedback(), 0);
});

test("new session and disposed view generation reject outstanding action responses", async () => {
  for (const change of ["session", "generation"]) {
    const f = teacherActions(); const request = delayedResponse(f); const pending = request.drop();
    if (change === "session") f.apply({ arena: { status: "lobby", revision: 12, sessionId: "new-session" }, participants: [] } as unknown as ArenaSnapshot);
    else f.refs.actionGenerationRef.current++;
    const before = JSON.stringify(f.state);
    request.release(committedAction(13)); await pending;
    assert.equal(JSON.stringify(f.state), before); assert.equal(f.feedback(), 0);
  }
});

test("late shield and power result events cannot overwrite a reconciled terminal participant", () => {
  const f = teacherActions(); const final = finalTeacherSnapshot();
  // Preserve the committed protection state even if an older blocked alias arrives later.
  final.participants = final.participants!.map((p) => ({ ...p, hasShield: true }));
  f.apply(final);
  const before = JSON.stringify(f.state.participants);
  for (const name of ["handleAttackBlocked", "handleAttackHit"]) {
    const declaration = find("teacher", (node) => ts.isVariableDeclaration(node) && node.name.getText(files.teacher) === name) as ts.VariableDeclaration;
    compile("teacher", declaration.initializer!, { ...f.context, claimArenaFeedback: () => true, displayedCombatFeedbackRef: { current: new Set() } })({
      attackId: name, sessionId: "session", arenaRevision: 11, targetStudentId: "a", targetCurrentScore: 0,
      attackerName: "B", targetName: "A", powerType: "meteor", participants: people(0),
    });
  }
  assert.equal(JSON.stringify(f.state.participants), before); assert.equal(f.state.phase, "podium");
});

test("race then refresh/reconnect agrees with persisted result without extra EXP/rewards/notifications", async () => {
  const fixture = arenaFixture(); await fixture.answer("a"); await fixture.action("airdrop"); await fixture.action("end");
  const serialize = () => JSON.stringify(fixture.data, (_key, item) => item instanceof Map ? [...item] : item);
  const before = serialize(), events = fixture.events.length;
  const route = fixture.load("arena/[id]", "teacher", "teacher");
  const snapshot = async () => (await route.GET({ nextUrl: { searchParams: new URLSearchParams({ view: "snapshot" }) } }, { params: Promise.resolve({ id: "77" }) })).body;
  const f = teacherActions(); const request = delayedResponse(f); const pending = request.drop();
  f.refs.arenaRevisionRef.current = 0;
  f.apply(await snapshot()); request.release(committedAction(1)); await pending;
  for (let i = 0; i < 2; i++) f.apply(await snapshot());
  assert.equal(f.state.participants.find((p) => p.id === "a").score, 150); assert.equal(f.state.phase, "podium");
  assert.equal(serialize(), before); assert.equal(fixture.events.length, events);
});

function studentActions(transport?: typeof fetch) {
  const f = client("student");
  const state = { shield: false, powers: {} as Record<string, boolean>, feedback: 0, question: 0 };
  Object.assign(f.context, { setTimeout, clearTimeout, AbortController, gameplayTimersRef: { current: new Set() }, gameplayRequestsRef: { current: new Map() },
    currentSessionId: "session", currentQuestionIndex: 0, questions: [{ id: 1, points: 100 }, { id: 2, points: 100 }],
    isSubmittingAnswer: false, streak: 0, highestStreak: 0, soundEnabled: false, usedPowers: {}, rivals: [],
    incomingAttack: { attackId: "attack", attackerName: "B", powerType: "meteor" }, isShieldActivating: false, reactionTimeLeftMs: 1000,
    displayedAttackFeedbackRef: { current: new Set() }, claimAttackFeedback: () => true,
    getShieldTerminalOutcome: (d: { deflected?: boolean }) => d.deflected ? "deflected" : null,
    setHasGuardianShield(value: boolean) { state.shield = value; },
    setUsedPowers(value: Record<string, boolean> | ((prev: Record<string, boolean>) => Record<string, boolean>)) {
      state.powers = typeof value === "function" ? value(state.powers) : value;
    },
    setSelectedChoice() {}, setErrorMessage() {}, setLockedAnswers() {}, setAnswerFeedback() {},
    playFeedbackChime() { state.feedback++; }, setStreak() {}, setHighestStreak() {}, setQuestionsCompleted() {},
    setBattleLogs() {}, setCelebrationMessage() {}, setIsShieldActivating() {},
    setCurrentQuestionIndex(update: number | ((previous: number) => number)) { state.question = typeof update === "function" ? update(state.question) : update; },
  });
  for (const name of ["clearGameplayTimers", "captureGameplayAction", "scheduleGameplayCallback", "applyGameplayState"]) {
    f.context[name] = callback("student", name, f.context);
  }
  f.context.refreshArenaState = async () => {};
  const direct = (name: string) => {
    const declaration = find("student", (node) => ts.isVariableDeclaration(node) && node.name.getText(files.student) === name) as ts.VariableDeclaration;
    return compile("student", declaration.initializer!, f.context);
  };
  const replies: Array<(body: object, ok?: boolean) => void> = [];
  f.context.fetch = transport ?? (() => new Promise((resolve) => replies.push((body, ok = true) => resolve({ ok, json: async () => body }))));
  f.context.readGameplayResponse = callback("student", "readGameplayResponse", f.context);
  const event = (name: string) => {
    const bind = find("student", (node) => ts.isCallExpression(node) && node.expression.getText(files.student) === "arenaChannel.bind"
      && node.arguments[0]?.getText(files.student) === JSON.stringify(name)) as ts.CallExpression;
    return compile("student", bind.arguments[1], f.context);
  };
  return { ...f, apply: callback("student", "applyArenaSnapshot", f.context), protection: state, replies, answer: direct("handleSelectChoice"), power: direct("executeBattlePower"),
    shield: direct("handleDefendIncomingAttack"), airdrop: event("arena-airdrop"),
    scoreEvent: event("arena-score-updated"), leaderboardEvent: event("arena-leaderboard-updated"),
    dispose: f.context.clearGameplayTimers as () => void };
}
function studentCommit(revision = 11, score = 100, shield = false) {
  return { ...committedAction(revision, score, shield), isCorrect: true, choiceId: 1, score,
    rank: 1, totalCount: 2, usedPowers: { shield } };
}
for (const reason of ["timer_expiry", "teacher_end"]) test("Student late answer after " + reason + ": terminal 100 never becomes 200", async (t) => {
  const f = studentActions(); t.after(f.dispose); const pending = f.answer(1);
  const final = finalTeacherSnapshot(reason, 100); final.result = { score: 100, rank: 2, expEarned: 150 };
  f.apply(final); const before = JSON.stringify([f.state, f.protection]);
  f.replies[0](studentCommit()); await pending;
  assert.equal(f.state.score, 100); assert.equal(f.state.rank, 2); assert.equal(f.state.phase, "podium");
  assert.equal(JSON.stringify([f.state, f.protection]), before);
});
for (const action of ["power", "shield"] as const) test("Student late " + action + " reply preserves terminal protection and results", async (t) => {
  const f = studentActions(); t.after(f.dispose);
  const pending = action === "power" ? f.power("shield") : f.shield();
  const final = finalTeacherSnapshot("teacher_end", 100); final.usedPowers = { shield: true };
  f.apply(final); const before = JSON.stringify([f.state, f.protection]);
  f.replies[0]({ ...studentCommit(11, 0, true), deflected: true }); await pending;
  assert.equal(JSON.stringify([f.state, f.protection]), before);
});
test("Student duplicate/late airdrop cannot double-add score or rearm a consumed power", (t) => {
  const f = studentActions(); t.after(f.dispose); const data = studentCommit(11, 50, true);
  f.airdrop(data); f.airdrop(data);
  assert.equal(f.state.score, 50); assert.equal(f.protection.shield, true); assert.equal(f.protection.powers.shield, true);
  f.apply(finalTeacherSnapshot("timer_expiry", 50)); const before = JSON.stringify([f.state, f.protection]);
  f.airdrop(data); assert.equal(JSON.stringify([f.state, f.protection]), before);
});
test("Student normal answer uses committed score and retains feedback/question progression", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] }); const f = studentActions(); t.after(f.dispose);
  const pending = f.answer(1); f.replies[0](studentCommit(11, 37)); await pending;
  assert.equal(f.state.score, 37); assert.equal(f.protection.feedback, 1);
  t.mock.timers.tick(1000); assert.equal(f.protection.question, 1);
});
test("Student normal power displays committed protection without optimistic mutation", async (t) => {
  const f = studentActions(); t.after(f.dispose); const pending = f.power("shield");
  assert.equal(f.protection.shield, false); assert.deepEqual(f.protection.powers, {});
  f.replies[0](studentCommit(11, 42, true)); await pending;
  assert.equal(f.state.score, 42); assert.equal(f.protection.shield, true); assert.equal(f.protection.powers.shield, true);
});
test("Student overlapping answer/power requests preserve the newest committed revision", async (t) => {
  const f = studentActions(); t.after(f.dispose); const answer = f.answer(1), power = f.power("shield");
  f.replies[1](studentCommit(12, 123, true)); await power;
  f.replies[0](studentCommit(11, 100, false)); await answer;
  assert.equal(f.state.score, 123); assert.equal(f.protection.shield, true); assert.equal(f.protection.powers.shield, true);
});
test("Student reordered realtime scores obey the same committed revision precedence", (t) => {
  const f = studentActions(); t.after(f.dispose);
  f.leaderboardEvent(studentCommit(12, 123, true));
  f.scoreEvent({ ...studentCommit(11, 20, false), studentId: "a" });
  f.airdrop(studentCommit(11, 70, false));
  assert.equal(f.state.score, 123); assert.equal(f.protection.shield, true);
  f.apply(terminal(13, 123));
  f.scoreEvent({ ...studentCommit(14, 999, false), studentId: "a" });
  f.leaderboardEvent(studentCommit(14, 999, false));
  assert.equal(f.state.score, 123); assert.equal(f.state.phase, "podium");
});
for (const change of ["session", "generation"]) test("Student prior " + change + " reply cannot alter the current view", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] }); const f = studentActions(); t.after(f.dispose); const pending = f.answer(1);
  if (change === "session") f.apply({ arena: { status: "lobby", revision: 12, sessionId: "new-session" }, participants: [] } as unknown as ArenaSnapshot);
  else f.refs.finalizationGenerationRef.current++;
  const before = JSON.stringify([f.state, f.protection]); f.replies[0](studentCommit(13)); await pending;
  t.mock.timers.tick(60_000); assert.equal(JSON.stringify([f.state, f.protection]), before);
});
test("Student terminal reconciliation cancels an already-scheduled answer progression timer", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] }); const f = studentActions(); t.after(f.dispose);
  const pending = f.answer(1); f.replies[0](studentCommit()); await pending;
  assert.equal(f.context.gameplayTimersRef.current.size, 1);
  f.apply(finalTeacherSnapshot("timer_expiry", 100)); assert.equal(f.context.gameplayTimersRef.current.size, 0);
  t.mock.timers.tick(60_000); assert.equal(f.state.phase, "podium"); assert.equal(f.protection.question, 0);
});
test("Student insufficient reply triggers reconciliation instead of calculating score", async (t) => {
  const f = studentActions(); t.after(f.dispose); const pending = f.answer(1);
  f.replies[0]({ success: true, isCorrect: true, score: 999 }); await pending;
  assert.equal(f.state.score, 20); f.apply(terminal(12, 100)); assert.equal(f.state.score, 100);
});
for (const reason of ["terminal", "timeout", "unmount"]) test("Student pending action request is cancelled on " + reason + " with no retained timers", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let aborted = 0;
  const transport = ((_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
    options.signal!.addEventListener("abort", () => { aborted++; reject(new Error("aborted")); }, { once: true });
  })) as typeof fetch;
  const f = studentActions(transport); t.after(f.dispose); const pending = f.answer(1);
  assert.equal(f.context.gameplayRequestsRef.current.size, 1);
  if (reason === "terminal") f.apply(terminal(12, 100));
  else if (reason === "timeout") t.mock.timers.tick(5000);
  else { f.refs.finalizationGenerationRef.current++; f.dispose(); }
  await pending;
  assert.equal(aborted, 1); assert.equal(f.context.gameplayRequestsRef.current.size, 0);
  assert.equal(f.context.gameplayTimersRef.current.size, 0);
  assert.equal(f.state.score, reason === "terminal" ? 100 : 20);
  t.mock.timers.tick(60_000); assert.equal(aborted, 1);
});
test("Student dropped realtime, late answer and reconnect preserve persisted result and completion side effects", async (t) => {
  const fixture = arenaFixture(); await fixture.answer("a"); await fixture.action("end");
  const serialize = () => JSON.stringify(fixture.data, (_key, item) => item instanceof Map ? [...item] : item);
  const before = serialize(), events = fixture.events.length;
  const f = studentActions(); t.after(f.dispose); f.refs.arenaRevisionRef.current = 0; const pending = f.answer(1);
  const read = async () => (await fixture.load("arena/[id]", "a").GET({ nextUrl: { searchParams: new URLSearchParams({ view: "snapshot" }) } }, { params: Promise.resolve({ id: "77" }) })).body;
  const worker = startArenaReconciliation({ read, apply: f.apply }); t.after(() => worker.stop()); await flush();
  f.replies[0](studentCommit(1)); await pending; await worker.refresh(); await worker.refresh();
  assert.equal(f.state.score, 100); assert.equal(f.state.phase, "podium");
  assert.equal(serialize(), before); assert.equal(fixture.events.length, events);
});
test("Arena answer/power replies expose actual committed revision and own protection facts", async () => {
  const f = arenaFixture(); const answer = await f.answer("a");
  assert.equal(answer.body.arenaRevision, f.read().revision); assert.equal(answer.body.sessionId, f.read().sessionId);
  const power = await f.attack("a", "shield");
  assert.equal(power.body.arenaRevision, f.read().revision); assert.equal(power.body.usedPowers.shield, true);
  assert.equal(power.body.participants.find((p: { studentId: string }) => p.studentId === "a").hasShield, true);
});

function enrollmentClient(kind: "teacher" | "student") {
  const f = client(kind);
  Object.assign(f.context, { playJoinChime() {}, setBattleEvents() {} });
  const handler = kind === "teacher"
    ? actionCallback("handleStudentJoined", f.context)
    : compile("student", (find("student", node => ts.isCallExpression(node) && node.expression.getText(files.student) === "arenaChannel.bind"
      && node.arguments[0]?.getText(files.student) === '"arena-student-joined"') as ts.CallExpression).arguments[1], f.context);
  let deliver!: (data: unknown) => void;
  guardArenaChannel({ bind(_event: string, run: (data: unknown) => void) { deliver = run; } }, f.refs.arenaRevisionRef,
    { getIdentity: f.context.readRealtimeIdentity })
    .bind("arena-student-joined", handler);
  return { ...f, deliver };
}
function enrollmentPayload() {
  const route = ts.createSourceFile("join.ts", fs.readFileSync("src/app/api/quizzes/join/route.ts", "utf8"), ts.ScriptTarget.Latest, true);
  let payload: ts.Expression | undefined;
  const visit = (node: ts.Node) => {
    if (!payload && ts.isVariableDeclaration(node) && node.name.getText(route) === "arenaPayload") payload = node.initializer;
    ts.forEachChild(node, visit);
  };
  visit(route); assert.ok(payload);
  const exports: { payload?: object } = {};
  vm.runInNewContext(ts.transpileModule(`exports.payload=${payload.getText(route)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, Date, quiz: { id: 77 }, session: { userId: "enrolled-only", fullName: "Enrollment hint" }, studentInitials: "EH" });
  return exports.payload!;
}
for (const kind of ["teacher", "student"] as const) for (const reason of ["teacher_end", "timer_expiry"]) {
  test(`${kind} exact unversioned enrollment after ${reason} preserves terminal 150/100 and does not restart polling`, async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] }); const f = enrollmentClient(kind); let reads = 0;
    const final = finalTeacherSnapshot(reason, 150);
    const worker = startArenaReconciliation({ read: async () => { reads++; return final; }, apply: f.apply });
    f.refs.reconciliationRef.current = worker; t.after(() => worker.stop()); await flush();
    assert.equal(f.state.phase, "podium"); assert.equal(f.refs.arenaRevisionRef.current, 12);
    const before = JSON.stringify(f.state);
    for (let i = 0; i < 100; i++) f.deliver(enrollmentPayload());
    // A legacy payload with participants is still only a hint.
    f.deliver({ ...enrollmentPayload(), participants: people(0) });
    t.mock.timers.tick(60_000); await flush();
    assert.equal(JSON.stringify(f.state), before); assert.equal(reads, 1);
    const displayed = kind === "teacher" ? f.state.participants : f.state.podium;
    assert.deepEqual(JSON.parse(JSON.stringify(displayed.map(p => [p.id ?? p.studentId, p.score]))), [["a", 150], ["b", 100]]);
  });
}
test("Teacher active enrollment burst coalesces into one read and discovers a committed Student exactly once", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] }); const f = enrollmentClient("teacher"); let reads = 0;
  const active = { ...committedAction(11, 150, false), arenaRevision: 11 } as unknown as ArenaSnapshot;
  const joined = { ...committedAction(12, 150, false), arenaRevision: 12,
    participants: [...people(150), { ...people()[0], studentId: "enrolled-only", studentName: "Enrollment hint", score: 37, rank: 3 }] } as unknown as ArenaSnapshot;
  const worker = startArenaReconciliation({ read: async () => ++reads === 1 ? active : joined, apply: f.apply });
  f.refs.reconciliationRef.current = worker; t.after(() => worker.stop()); await flush();
  for (let i = 0; i < 100; i++) f.deliver(enrollmentPayload());
  assert.equal(f.state.participants.length, 2); assert.equal(f.refs.arenaRevisionRef.current, 11);
  t.mock.timers.tick(999); await flush(); assert.equal(reads, 1);
  t.mock.timers.tick(1); await flush(); assert.equal(reads, 2);
  assert.equal(f.state.participants.length, 3); assert.equal(f.state.participants.filter(p => p.id === "enrolled-only").length, 1);
  assert.equal(f.state.participants.find(p => p.id === "enrolled-only").score, 37);
  // Even a join carrying a future revision cannot promote an enrollment into state.
  f.deliver({ ...enrollmentPayload(), arenaRevision: 999, sessionId: "session" });
  assert.equal(f.refs.arenaRevisionRef.current, 12);
  t.mock.timers.tick(1000); await flush(); assert.equal(reads, 3); assert.equal(f.state.participants.length, 3);
});
test("Teacher old session/quiz enrollment is ignored and disposed generation cancels pending hint", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] }); const f = enrollmentClient("teacher"); let reads = 0;
  const active = committedAction(11) as unknown as ArenaSnapshot;
  const worker = startArenaReconciliation({ read: async () => { reads++; return active; }, apply: f.apply });
  f.refs.reconciliationRef.current = worker; t.after(() => worker.stop()); await flush();
  f.deliver({ ...enrollmentPayload(), sessionId: "old-session" });
  f.deliver({ ...enrollmentPayload(), quizId: 88 });
  const before = JSON.stringify(f.state); t.mock.timers.tick(1000); await flush(); assert.equal(reads, 1);
  f.deliver(enrollmentPayload()); worker.stop(); f.refs.actionGenerationRef.current++; f.refs.actionQuizRef.current = 88;
  f.deliver(enrollmentPayload()); t.mock.timers.tick(60_000); await flush();
  assert.equal(reads, 1); assert.equal(JSON.stringify(f.state), before);
});
test("unversioned state messages are hints; informational combat feedback retains no revision authority", () => {
  const cursor = { current: 12 }; let stateCalls = 0, hints = 0, feedback = 0;
  const callbacks = new Map<string, (data: unknown) => void>();
  const channel = guardArenaChannel({ bind(event: string, run: (data: unknown) => void) { callbacks.set(event, run); } }, cursor,
    { getIdentity: () => ({ quizId: 77, sessionId: "session", terminal: false }), onStateHint() { hints++; } });
  channel.bind("arena-score-updated", () => { stateCalls++; });
  channel.bind("arena-attack-blocked", () => { feedback++; });
  callbacks.get("arena-score-updated")!({ score: 999 }); callbacks.get("arena-attack-blocked")!({ quizId: 77, sessionId: "session", attackId: "feedback" });
  assert.equal(stateCalls, 0); assert.equal(hints, 1); assert.equal(feedback, 1); assert.equal(cursor.current, 12);
  assert.equal(acceptArenaRevision(cursor, { participants: people(0) }), false); assert.equal(acceptArenaRevision(cursor, null), false);
});
test("join hints during stalled read remain bounded; cleanup aborts the request and removes scheduling", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] }); let reads = 0, aborted = 0;
  const worker = startArenaReconciliation({ read: async signal => {
    if (++reads === 1) return committedAction(11) as unknown as ArenaSnapshot;
    return new Promise((_resolve, reject) => signal.addEventListener("abort", () => { aborted++; reject(Error("cancelled")); }, { once: true }));
  }, apply: () => false });
  t.after(() => worker.stop()); await flush();
  for (let i = 0; i < 100; i++) worker.hint(); t.mock.timers.tick(1000); await flush(); assert.equal(reads, 2);
  for (let i = 0; i < 100; i++) worker.hint(); worker.stop(); await flush();
  t.mock.timers.tick(60_000); await flush(); assert.equal(reads, 2); assert.equal(aborted, 1);
});
test("post-completion enrollment hints/readback preserve EXP, reward markers, notifications and completion facts", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] }); const fixture = arenaFixture(); await fixture.answer("a"); await fixture.action("end");
  const serialize = () => JSON.stringify(fixture.data, (_key, item) => item instanceof Map ? [...item] : item);
  const before = serialize(), events = fixture.events.length, f = enrollmentClient("teacher"); f.refs.arenaRevisionRef.current = 0;
  let reads = 0;
  const read = async () => { reads++; return (await fixture.load("arena/[id]", "teacher", "teacher").GET({ nextUrl: { searchParams: new URLSearchParams({ view: "snapshot" }) } }, { params: Promise.resolve({ id: "77" }) })).body; };
  const initial = await read(); let firstRead = true;
  const worker = startArenaReconciliation({ read: () => {
    if (firstRead) { firstRead = false; return Promise.resolve(initial); }
    return read();
  }, apply: f.apply }); f.refs.reconciliationRef.current = worker; t.after(() => worker.stop()); await flush();
  const displayed = JSON.stringify(f.state.participants);
  for (let i = 0; i < 100; i++) f.deliver(enrollmentPayload()); t.mock.timers.tick(60_000); await flush(); assert.equal(reads, 1);
  await worker.refresh(); await worker.refresh();
  assert.equal(JSON.stringify(f.state.participants), displayed); assert.equal(serialize(), before); assert.equal(fixture.events.length, events);
});

function realtimeClient(kind: "teacher" | "student", quizId = 77, sessionId = "session") {
  const f = client(kind); let feedback = 0, hints = 0, sessionHints = 0, live = true;
  const state = Object.assign(f.state, { protection: { shield: false, powers: {} as Record<string, boolean> } });
  Object.assign(f.context, { quizId, quiz: { id: quizId, questions: [1, 2] }, currentSessionId: sessionId,
    claimArenaFeedback, hasTerminalArenaFeedback: (displayed: Set<string>, id: string) => displayed.has(`${id}:hit`) || displayed.has(`${id}:deflected`),
    displayedCombatFeedbackRef: { current: new Set() }, displayedAttackFeedbackRef: { current: new Set() },
    claimAttackFeedback: () => true, getServerAdjustedNow: () => Date.now(),
    setBattleEvents() { feedback++; }, showAttackFeedback() { feedback++; return true; },
    setIsShieldActivating() {}, setReactionTimeLeftMs() {}, soundEnabled: false,
    setCelebrationMessage() {}, refreshArenaState: async () => {}, playJoinChime() {},
    setHasGuardianShield(value: boolean) { state.protection.shield = value; },
    setUsedPowers(value: Record<string, boolean>) { state.protection.powers = value; },
  });
  f.refs.actionQuizRef.current = quizId; f.refs.arenaSessionRef.current = sessionId; f.refs.snapshotSessionRef.current = sessionId;
  f.context.readRealtimeIdentity = callback(kind, "readRealtimeIdentity", f.context);
  if (kind === "student") {
    f.context.captureGameplayAction = callback(kind, "captureGameplayAction", f.context);
    f.context.applyGameplayState = callback(kind, "applyGameplayState", f.context);
  }
  const callbacks = new Map<string, (data: unknown) => void>();
  const channel = guardArenaChannel({ bind(event: string, run: (data: unknown) => void) { callbacks.set(event, run); } }, f.refs.arenaRevisionRef,
    { getIdentity: f.context.readRealtimeIdentity, isLive: () => live,
      onStateHint() { hints++; f.refs.reconciliationRef.current?.hint(); },
      onSessionHint() { sessionHints++; f.refs.reconciliationRef.current?.hint({ allowTerminal: true }); } });
  const compileHandler = (node: ts.Node): ((data: unknown) => void) => {
    if (ts.isIdentifier(node)) {
      const variable = find(kind, n => ts.isVariableDeclaration(n) && n.name.getText(files[kind]) === node.getText(files[kind])) as ts.VariableDeclaration;
      return compileHandler(variable.initializer!);
    }
    return compile(kind, node, f.context);
  };
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(files[kind]) === "arenaChannel.bind" && ts.isStringLiteral(node.arguments[0])) {
      channel.bind(node.arguments[0].text, compileHandler(node.arguments[1]));
    }
    ts.forEachChild(node, visit);
  };
  visit(files[kind]);
  return { ...f, state, apply: callback(kind, "applyArenaSnapshot", f.context),
    deliver(event: string, data: unknown) { const run = callbacks.get(event); assert.ok(run, `Actual ${kind} callback for ${event}`); run(data); },
    feedback: () => feedback, hints: () => hints, sessionHints: () => sessionHints, dispose: () => { live = false; },
  };
}

async function producedHit(quizId: number, sessionId: string, revision: number, score = 0) {
  const fixture = arenaFixture(), state = fixture.read(); state.quizId = quizId; state.sessionId = sessionId; state.revision = revision;
  delete state.participants.c; state.participants.a.score = score; state.participants.b.score = 100;
  const effects: Array<(options: { signal: AbortSignal }) => Promise<void>> = [], events: Array<{ event: string; data: any; channels: unknown }> = [];
  const producer = loadArenaModule("src/lib/arena-realtime.ts", { "./arena.ts": fixture.arena,
    "@/lib/pusher": { arenaPusher: { async trigger(channels: unknown, event: string, data: unknown) { events.push({ channels, event, data }); } } } });
  const mutation = { state, afterCommit(work: (options: { signal: AbortSignal }) => Promise<void>) { effects.push(work); } };
  await producer.broadcastArenaAttackHit(quizId, state, {
    attack: { attackId: `hit-${quizId}-${sessionId}-${revision}`, sessionId, attackerId: "b", attackerName: "B", targetStudentId: "a", targetName: "A", powerType: "meteor" },
    target: state.participants.a, participants: fixture.arena.computeArenaRankings(state.participants),
  }, producer.arenaRealtime(mutation));
  assert.equal(events.length, 0, "identity metadata and delivery remain post-commit");
  for (const work of effects) await work({ signal: new AbortController().signal });
  const hit = events.find(e => e.event === "arena-attack-hit")!;
  assert.ok((hit.channels as string[]).includes("private-teacher-teacher"));
  assert.equal(hit.data.quizId, quizId); assert.equal(hit.data.sessionId, sessionId); assert.equal(hit.data.arenaRevision, revision);
  return hit.data;
}

test("exact Teacher foreign Arena hit cannot replace terminal 150/100 or poison its revision-12 readback", async () => {
  const f = realtimeClient("teacher"); const terminal = finalTeacherSnapshot("teacher_end", 150); f.apply(terminal);
  const before = JSON.stringify(f.state); f.deliver("arena-attack-hit", await producedHit(88, "foreign-session", 13));
  assert.equal(JSON.stringify(f.state), before); assert.equal(f.refs.arenaRevisionRef.current, 12);
  assert.equal(f.apply(terminal), true); assert.equal(f.state.participants.find(p => p.id === "a").score, 150);
  assert.equal(f.state.participants.find(p => p.id === "a").rank, 1);
});
for (const kind of ["teacher", "student"] as const) {
  test(`${kind} accepts a matching active hit at revision 13`, async () => {
    const f = realtimeClient(kind); f.apply(committedAction(12, 150, false) as unknown as ArenaSnapshot);
    f.deliver("arena-attack-hit", await producedHit(77, "session", 13, 37));
    assert.equal(f.refs.arenaRevisionRef.current, 13);
    assert.equal(kind === "teacher" ? f.state.participants.find(p => p.id === "a").score : f.state.score, 37);
  });
  test(`${kind} rejects foreign Arena and old session before revision comparison`, async () => {
    const f = realtimeClient(kind); f.apply(committedAction(12, 150, false) as unknown as ArenaSnapshot); const before = JSON.stringify(f.state);
    for (const [id, session] of [[88, "session"], [77, "old-session"]] as const) {
      f.deliver("arena-attack-hit", await producedHit(id, session, 999));
      f.deliver("arena-score-updated", { quizId: id, sessionId: session, arenaRevision: 999, studentId: "a", score: 999, rank: 1 });
      f.deliver("arena-student-joined", { quizId: id, sessionId: session, studentId: "foreign" });
    }
    assert.equal(JSON.stringify(f.state), before); assert.equal(f.refs.arenaRevisionRef.current, 12); assert.equal(f.feedback(), 0); assert.equal(f.hints(), 0);
    assert.equal(f.apply(finalTeacherSnapshot("timer_expiry", 150)), true);
  });
  test(`${kind} terminal state ignores matching and foreign gameplay, shield and phase events`, async () => {
    const f = realtimeClient(kind); f.apply(finalTeacherSnapshot("timer_expiry", 150)); const before = JSON.stringify(f.state);
    const hit = await producedHit(77, "session", 13);
    for (const quizId of [77, 88]) for (const event of ["arena-attack-hit", "arena-attack-blocked", "arena-score-updated", "arena-leaderboard-updated", "arena-start", "arena-end"]) {
      f.deliver(event, { ...hit, quizId, studentId: "a", score: 999, usedPowers: { shield: false }, arena: { quizId, sessionId: "session", revision: 13, status: "active" }, participants: people(999).map(p => ({ ...p, hasShield: true })) });
    }
    assert.equal(JSON.stringify(f.state), before); assert.equal(f.refs.arenaRevisionRef.current, 12); assert.equal(f.feedback(), 0);
  });
  test(`${kind} matching unversioned combat is feedback only and unscoped messages only request a read`, async () => {
    const f = realtimeClient(kind); f.apply(committedAction(12, 150, false) as unknown as ArenaSnapshot); const before = JSON.stringify(f.state);
    const hit = await producedHit(77, "session", 13); delete hit.arenaRevision;
    f.deliver("arena-attack-hit", hit); assert.equal(f.feedback(), 1);
    assert.equal(JSON.stringify(f.state), before); assert.equal(f.refs.arenaRevisionRef.current, 12);
    const legacy = { ...hit, arenaRevision: 999 }; delete legacy.quizId; delete legacy.sessionId;
    f.deliver("arena-attack-hit", legacy); f.deliver("arena-score-updated", { studentId: "a", score: 999, arenaRevision: 999 });
    assert.equal(f.feedback(), 1); assert.equal(f.hints(), 2); assert.equal(f.refs.arenaRevisionRef.current, 12); assert.equal(JSON.stringify(f.state), before);
  });
  test(`${kind} disposed generation drops late callbacks and conflicting identity`, async () => {
    const f = realtimeClient(kind); const before = JSON.stringify(f.state); const hit = await producedHit(77, "session", 13);
    f.deliver("arena-attack-hit", { ...hit, arena: { quizId: 88, sessionId: "session", revision: 13 } });
    f.deliver("arena-score-updated", { ...hit, sessionId: "session", arena: { quizId: 77, sessionId: "old-session", revision: 13 } });
    f.dispose(); f.deliver("arena-attack-hit", hit);
    assert.equal(f.refs.arenaRevisionRef.current, 10); assert.equal(JSON.stringify(f.state), before);
  });
}
test("two simultaneous Teacher Arena views share a channel but consume only their own identity", async () => {
  const first = realtimeClient("teacher", 77, "session"), second = realtimeClient("teacher", 88, "session-B");
  const own = await producedHit(77, "session", 13, 37), foreign = await producedHit(88, "session-B", 999, 50);
  for (const hit of [foreign, own, foreign, own]) { first.deliver("arena-attack-hit", hit); second.deliver("arena-attack-hit", hit); }
  assert.equal(first.refs.arenaRevisionRef.current, 13); assert.equal(second.refs.arenaRevisionRef.current, 999);
  assert.equal(first.state.participants.find(p => p.id === "a").score, 37); assert.equal(second.state.participants.find(p => p.id === "a").score, 50);
});
test("reset notification never adopts session/cursor; one bounded read adopts the persisted new session", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] }); const f = realtimeClient("student"); let reads = 0;
  const next = { ...committedAction(13, 0, false, "new-session"), arena: { quizId: 77, status: "lobby", sessionId: "new-session", revision: 13 } } as unknown as ArenaSnapshot;
  const worker = startArenaReconciliation({ read: async () => ++reads === 1 ? finalTeacherSnapshot("teacher_end", 150) : next, apply: f.apply });
  f.refs.reconciliationRef.current = worker; t.after(() => worker.stop()); await flush();
  for (let i = 0; i < 20; i++) f.deliver("arena-reset", { quizId: 77, sessionId: "new-session", arenaRevision: 999 });
  assert.equal(f.refs.snapshotSessionRef.current, "session"); assert.equal(f.refs.arenaRevisionRef.current, 12); assert.equal(f.state.phase, "podium");
  t.mock.timers.tick(1000); await flush(); assert.equal(reads, 2);
  assert.equal(f.refs.snapshotSessionRef.current, "new-session"); assert.equal(f.refs.arenaRevisionRef.current, 13); assert.equal(f.state.phase, "lobby");
});
test("foreign events plus refreshed committed result preserve all EXP/reward/completion/notification facts", async () => {
  const fixture = arenaFixture(); await fixture.answer("a"); await fixture.action("end");
  const serialize = () => JSON.stringify(fixture.data, (_key, item) => item instanceof Map ? [...item] : item);
  const before = serialize(), eventCount = fixture.events.length, f = realtimeClient("teacher", 77, "session-1"); f.refs.arenaRevisionRef.current = 0;
  const read = async () => (await fixture.load("arena/[id]", "teacher", "teacher").GET({ nextUrl: { searchParams: new URLSearchParams({ view: "snapshot" }) } }, { params: Promise.resolve({ id: "77" }) })).body;
  f.apply(await read()); const displayed = JSON.stringify(f.state.participants), revision = f.refs.arenaRevisionRef.current;
  f.deliver("arena-attack-hit", await producedHit(88, "foreign-session", 999));
  assert.equal(f.refs.arenaRevisionRef.current, revision); assert.equal(f.apply(await read()), true);
  assert.equal(JSON.stringify(f.state.participants), displayed); assert.equal(serialize(), before); assert.equal(fixture.events.length, eventCount);
});
test("all common Arena producers stamp canonical committed quiz/session/revision including Teacher answers", async () => {
  const f = arenaFixture(); await f.answer("a"); await f.attack("a", "shield"); await f.action("airdrop"); await f.action("end");
  for (const event of f.events.filter(e => e.event.startsWith("arena-") || e.event.startsWith("attack-"))) {
    assert.equal(event.data.quizId, 77); assert.equal(event.data.sessionId, "session-1"); assert.ok(Number.isSafeInteger(event.data.arenaRevision));
  }
});
