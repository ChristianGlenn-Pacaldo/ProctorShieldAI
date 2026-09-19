import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as runtime from "../src/lib/proctored-runtime.ts";
import * as grading from "../src/lib/quiz-submission.ts";
import * as devices from "../src/lib/device-capabilities.ts";
import * as detection from "../src/lib/proctoring-detection.ts";

// Execute the real route handlers with controlled database/network boundaries.
// Transactions serialize writes and roll back on failure, just as the row claim
// requires. These tests do not replace PostgreSQL/browser integration testing.
const compiled = new Map<string, string>();
function route(file: string, dependencies: Record<string, unknown>) {
  if (!compiled.has(file)) compiled.set(file, ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText);
  const exports: any = {};
  vm.runInNewContext(compiled.get(file)!, { exports, process: { env: {} }, console: { error() {}, warn() {} },
    Date, Set, Map, Promise, Number, String,
    require: (name: string) => {
      if (!(name in dependencies)) throw new Error(`Missing dependency ${name}`);
      return dependencies[name];
    },
  });
  return exports;
}
const request = (body: object) => ({ json: async () => body, headers: { get: () => "" } });

function fixture() {
  const questions = [1, 2, 3].map((id) => ({ id, points: 1, questionType: "multiple_choice", choices: [{ id: id * 10, isCorrect: true }] }));
  let state: any = {
    attempt: { id: "attempt-1", studentId: "student", quizId: 7, attemptNumber: 1, attemptMode: "proctored",
      startTime: new Date(), endTime: null, quizStatus: "in_progress", monitoringLevel: "strict",
      quiz: { id: 7, title: "Exam", teacherId: "teacher", duration: 10, quizStatus: "in_progress", quizMode: "proctored", _count: { questions: 3 } } },
    answers: [], violations: [], settings: {}, exp: 0, notifications: 0,
  };
  let tail = Promise.resolve();
  let failReward = false;
  const copy = (value: any) => structuredClone(value);
  const matches = (where: any) => {
    const a = state.attempt;
    return (!where.id || where.id === a.id) && (!where.studentId || where.studentId === a.studentId)
      && (where.endTime !== null || a.endTime === null)
      && (where.startTime !== null || a.startTime === null)
      && (typeof where.quizStatus !== "string" || where.quizStatus === a.quizStatus);
  };
  const db: any = {
    studentQuiz: {
      findFirst: async ({ where }: any) => matches(where) ? { ...copy(state.attempt), violations: copy(state.violations) } : null,
      findUnique: async () => copy(state.attempt),
      findMany: async () => state.attempt.quizStatus === "completed" ? [copy(state.attempt)] : [],
      updateMany: async ({ where, data }: any) => {
        if (!matches(where)) return { count: 0 };
        Object.assign(state.attempt, data); return { count: 1 };
      },
      update: async ({ data }: any) => { Object.assign(state.attempt, data); return copy(state.attempt); },
    },
    quiz: { findUnique: async () => copy(state.attempt.quiz) },
    question: { findMany: async () => copy(questions), findFirst: async () => ({ id: 1, points: 1, choices: [{ id: 10, isCorrect: true, choiceText: "Paris" }] }) },
    choice: { findFirst: async () => ({ id: 10, isCorrect: true, question: { points: 1 } }) },
    answer: {
      findMany: async () => copy(state.answers),
      findUnique: async ({ where }: any) => copy(state.answers.find((a: any) => a.questionId === where.studentQuizId_questionId.questionId) || null),
      deleteMany: async () => { state.answers = []; },
      createMany: async ({ data }: any) => { state.answers.push(...copy(data)); },
      upsert: async ({ create }: any) => { state.answers.push(copy(create)); },
    },
    setting: { findUnique: async ({ where }: any) => state.settings[where.settingKey] || null,
      create: async ({ data }: any) => { state.settings[data.settingKey] = data; } },
    violation: { findMany: async () => copy(state.violations), count: async () => state.violations.length,
      findUnique: async ({ where }: any) => state.violations.find((v: any) => v.id === where.id),
      create: async ({ data }: any) => { const v = { ...data, id: BigInt(1) }; state.violations.push(v); return v; } },
    notification: { createMany: async () => { state.notifications++; } },
    aiAnalysis: { upsert: async () => {} },
    $executeRaw: async () => {},
    $transaction: async (fn: any) => {
      const previous = tail;
      let release!: () => void;
      tail = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      const before = copy(state);
      try { return await fn(db); } catch (error) { state = before; throw error; } finally { release(); }
    },
  };
  const deps: any = {
    "next/server": { NextResponse: { json: (body: any, options: any = {}) => ({ status: options.status || 200, body }) } },
    "@/lib/prisma": { __esModule: true, default: db },
    "@/lib/auth": { getSession: async () => ({ userId: "student", role: "student", fullName: "Student" }) },
    "@/lib/pusher": { pusherServer: { trigger: async () => {} } },
    "@/lib/gemini": { generateGeminiWithFallback: async () => null },
    "@/lib/quiz-submission": grading,
    "@/lib/proctored-runtime": runtime,
    "@/lib/student-coins": { calculateQuizCoinReward: () => ({ coins: 0, isTopOne: false, rankTitle: "Rank #1", breakdown: {} }) },
    "@/lib/student-game-profile": { ensureStudentGameProfile: async () => ({ coins: 0 }) },
    "@/lib/student-progression": { EXP_REWARDS: { PROCTORED_COMPLETION: 100 }, getStudentProgression: async () => ({}),
      awardStudentExp: async (_id: string, amount: number, _reason: string, client: any) => {
        assert.equal(client, db, "EXP must commit with completion");
        if (failReward) throw new Error("reward storage unavailable");
        state.exp += amount; return { expAwarded: amount };
      } },
    "@prisma/client": {}, "@/lib/device-capabilities": devices,
    "@/lib/arena": { getArenaState: async () => null },
    "@/lib/security": { consumeRateLimitGroup: async () => ({ allowed: true }), getClientIp: () => "local" },
    "@/lib/evidence-storage": { uploadEvidence: async () => null },
    "@/lib/proctoring-detection": detection,
    "@/lib/teacher-entitlements": { hasActiveProSubscription: async () => true },
    "@/lib/snapshot-store": { saveSnapshot: async () => {}, getSnapshotsForTeacher: async () => [] },
  };
  const load = (path: string) => route(`src/app/api/${path}/route.ts`, deps);
  const submit = (reason: string, extra = {}) => load("quizzes/submit").POST(request({ quizId: 7, studentQuizId: "attempt-1", reason, answers: [], ...extra }));
  const strikes = (count: number) => { state.violations = Array.from({ length: count }, () => ({ violationType: "tab_switch", confidenceScore: 100, timestamp: new Date() })); };
  return { get state() { return state; }, db, deps, load, submit, strikes, questions, setFailReward: (value: boolean) => { failReward = value; } };
}

test("preflight updates capabilities without starting the attempt or clock", async () => {
  const f = fixture(); f.state.attempt.startTime = null; f.state.attempt.quizStatus = "enrolled";
  const response = await f.load("quizzes/session").POST(request({ quizId: 7, capabilities: {
    deviceType: "desktop", secureContext: true, cameraSupported: true, cameraPermission: true,
    microphoneSupported: true, microphonePermission: true, mediaRecorderSupported: true,
    visibilitySupported: true, fullscreenSupported: true,
  } }));
  assert.equal(response.status, 200); assert.equal(f.state.attempt.startTime, null); assert.equal(f.state.attempt.quizStatus, "enrolled");
});

test("lobby snapshot and live registration cannot start an enrolled attempt", async () => {
  const f = fixture(); f.state.attempt.startTime = null; f.state.attempt.quizStatus = "enrolled";
  for (const path of ["live/join", "live/snapshot"]) {
    const response = await f.load(path).POST(request({ quizId: 7, snapshot: "data:image/jpeg;base64,YQ==" }));
    assert.ok(response.status >= 400); assert.equal(f.state.attempt.startTime, null);
  }
});

test("explicit Start Exam initializes once and retry/refresh preserves the deadline", async () => {
  const f = fixture(); f.state.attempt.startTime = null; f.state.attempt.quizStatus = "enrolled";
  const start = () => f.load("quizzes/session").POST(request({ quizId: 7, studentQuizId: "attempt-1", action: "start" }));
  const first = await start(); assert.equal(first.status, 200); assert.equal(first.body.remainingSeconds, 600);
  const startTime = f.state.attempt.startTime.getTime();
  const second = await start(); assert.equal(second.status, 200); assert.equal(f.state.attempt.startTime.getTime(), startTime);
});

test("empty loading list, unanswered exam, one answer and foreign IDs never imply completion", () => {
  assert.equal(runtime.allQuestionsAnswered([], {}), false);
  const questions = [{ id: 1 }, { id: 2 }];
  for (const answers of [{}, { 1: 10 }, { 98: 1, 99: 2 }]) assert.equal(runtime.allQuestionsAnswered(questions, answers), false);
  assert.equal(runtime.allQuestionsAnswered(questions, { 1: 10, 2: 20 }), true);
});

test("absolute timer survives 60 idle seconds, suspension and expired refresh", () => {
  const start = 10_000; const deadline = start + 600_000;
  assert.equal(runtime.remainingExamSeconds(deadline, start + 60_000), 540);
  assert.equal(runtime.remainingExamSeconds(deadline, start + 300_000), 300);
  assert.equal(runtime.remainingExamSeconds(deadline, deadline + 5000), 0);
});

for (const reason of ["all_questions_completed", "timer_expired", "violation_limit", "teacher_ended", "unknown"]) {
  test(`server rejects premature ${reason} without completion or EXP`, async () => {
    const f = fixture(); const response = await f.submit(reason);
    assert.equal(response.status, 409); assert.equal(f.state.attempt.quizStatus, "in_progress"); assert.equal(f.state.exp, 0);
  });
}
test("preflight attempt cannot manually submit", async () => {
  const f = fixture(); f.state.attempt.startTime = null; f.state.attempt.quizStatus = "enrolled";
  assert.equal((await f.submit("manual")).status, 409); assert.equal(f.state.exp, 0);
});
test("stale attempt request cannot submit a new retake", async () => {
  const f = fixture(); assert.equal((await f.submit("manual", { studentQuizId: "old-attempt" })).status, 409); assert.equal(f.state.exp, 0);
});
test("final locked answer allows intended all-questions completion", async () => {
  const f = fixture(); f.state.answers = f.questions.map((q) => ({ questionId: q.id, answerText: String(q.id * 10), isCorrect: true }));
  const result = await f.submit("all_questions_completed"); assert.equal(result.status, 200); assert.equal(result.body.result.answeredCount, 3); assert.equal(result.body.result.score, 100);
});
for (const reasons of [["timer_expired", "timer_expired"], ["manual", "timer_expired"], ["violation_limit", "timer_expired"], ["teacher_ended", "manual"]]) {
  test(`${reasons.join(" + ")} collision completes once and rewards at most once`, async () => {
    const f = fixture(); f.state.attempt.startTime = new Date(Date.now() - 700_000); f.state.attempt.quiz.quizStatus = "ended";
    const invalidated = reasons.includes("violation_limit"); if (invalidated) f.strikes(3);
    const responses = await Promise.all(reasons.map((reason) => f.submit(reason)));
    assert.equal(responses.filter((r) => r.status === 200).length, 1);
    assert.equal(f.state.notifications, 1); assert.equal(f.state.exp, invalidated ? 0 : 100);
    assert.equal((await f.submit(reasons[0])).status, 409); assert.equal(f.state.exp, invalidated ? 0 : 100);
  });
}
for (const count of [1, 2, 3]) test(`${count}/3 authoritative strikes ${count < 3 ? "do not" : "do"} permit violation submission`, async () => {
  const f = fixture(); f.strikes(count); assert.equal((await f.submit("violation_limit")).status, count < 3 ? 409 : 200); assert.equal(f.state.exp, 0);
});
test("teacher end rejects wrong quiz and stale timestamps", () => {
  const started = Date.now(); const event = { quizId: 7, quizStatus: "ended", timestamp: new Date(started + 1).toISOString() };
  assert.equal(runtime.isCurrentTeacherEnd(event, "7", started), true);
  assert.equal(runtime.isCurrentTeacherEnd(event, "8", started), false);
  assert.equal(runtime.isCurrentTeacherEnd(event, "7", started + 2), false);
  assert.equal(runtime.isCurrentTeacherEnd({ quizId: 7, quizStatus: "ended" }, "7", started), false);
});
test("server ignores a teacher end predating a retake, and accepts an end during the retake", async () => {
  const f = fixture(); f.state.attempt.attemptNumber = 2; f.state.attempt.quiz.quizStatus = "ended";
  const startedAt = f.state.attempt.startTime.getTime();
  f.state.settings["proctored:quiz-ended:7"] = { settingValue: new Date(startedAt - 1000).toISOString() };
  assert.equal((await f.submit("teacher_ended")).status, 409);
  f.state.settings["proctored:quiz-ended:7"] = { settingValue: new Date(startedAt + 1000).toISOString() };
  assert.equal((await f.submit("teacher_ended")).status, 200); assert.equal(f.state.exp, 100);
});
test("failed EXP write rolls back completion and retry awards once", async () => {
  const f = fixture(); f.setFailReward(true); assert.equal((await f.submit("manual")).status, 500);
  assert.equal(f.state.attempt.quizStatus, "in_progress"); assert.equal(f.state.exp, 0);
  f.setFailReward(false); assert.equal((await f.submit("manual")).status, 200); assert.equal(f.state.exp, 100);
});
test("completed attempt cannot record an answer, including a request that read active state before completion", async () => {
  const f = fixture();
  const original = f.db.choice.findFirst;
  f.db.choice.findFirst = async () => { f.state.attempt.quizStatus = "completed"; f.state.attempt.endTime = new Date(); return original(); };
  const result = await f.load("quizzes/answer").POST(request({ quizId: 7, studentQuizId: "attempt-1", questionId: 1, choiceId: 10 }));
  assert.equal(result.status, 409); assert.equal(f.state.answers.length, 0);
});
test("submission rereads answers after claiming the attempt instead of deleting a concurrently saved answer", async () => {
  const f = fixture(); const tx = f.db.$transaction;
  f.db.$transaction = async (fn: any) => { f.state.answers.push({ questionId: 1, answerText: "10", isCorrect: true }); return tx(fn); };
  const result = await f.submit("manual"); assert.equal(result.body.result.answeredCount, 1); assert.equal(result.body.result.score, 33);
});
test("fill-in-blank correctness is resolved on server, including a wrong free-text answer", async () => {
  for (const [textAnswer, isCorrect] of [[" Paris ", true], ["London", false]] as const) {
    const f = fixture(); const result = await f.load("quizzes/answer").POST(request({ quizId: 7, studentQuizId: "attempt-1", questionId: 1, textAnswer }));
    assert.equal(result.status, 200); assert.equal(result.body.isCorrect, isCorrect);
    assert.equal(grading.gradeSubmission([{ id: 1, points: 1, questionType: "fill_in_blank", choices: [{ id: 10, isCorrect: true }] }], [{ questionId: 1, choiceId: result.body.choiceId }]).score, isCorrect ? 100 : 0);
  }
});
test("Pusher outage does not hide a persisted authoritative violation count", async () => {
  const f = fixture(); f.deps["@/lib/pusher"].pusherServer.trigger = async () => { throw Error("offline"); };
  const result = await f.load("live/violation").POST(request({ quizId: 7, studentQuizId: "attempt-1", violationType: "tab_switch", confidenceScore: 100 }));
  assert.equal(result.status, 200); assert.equal(result.body.violationCount, 1);
});
test("teacher snapshot fallback queries active proctored attempts and returns authoritative count without Redis", async () => {
  const f = fixture(); f.deps["@/lib/auth"].getSession = async () => ({ userId: "teacher", role: "teacher" });
  f.db.studentQuiz.findMany = async ({ where }: any) => {
    assert.equal(where.attemptMode, "proctored"); assert.equal(where.quiz.quizMode.not, "arena"); assert.equal(where.quizStatus, "in_progress");
    return [{ ...f.state.attempt, student: { fullName: "Student" }, _count: { violations: 2 } }];
  };
  const result = await f.load("live/snapshot").GET(); assert.equal(result.status, 200); assert.equal(result.body.snapshots[0].violationCount, 2); assert.equal(result.body.snapshots[0].studentId, "student");
  const monitor = fs.readFileSync("src/app/dashboard/teacher/monitor/content.tsx", "utf8");
  assert.doesNotMatch(monitor, /snap\.snapshot \|\| cur\.snapshot/, "do not retain a prior attempt's snapshot after the server clears it");
});

test("retry of the same persisted incident returns its count without another strike", async () => {
  const f = fixture(); const record = () => f.load("live/violation").POST(request({ quizId: 7, studentQuizId: "attempt-1", incidentId: "incident-1", violationType: "tab_switch" }));
  assert.equal((await record()).body.violationCount, 1);
  assert.equal((await record()).body.violationCount, 1);
  assert.equal(f.state.violations.length, 1);
});

test("violation arriving before submission claim is included in the integrity and EXP decision", async () => {
  const f = fixture(); f.strikes(2); const tx = f.db.$transaction;
  f.db.$transaction = async (fn: any) => { f.strikes(3); return tx(fn); };
  const result = await f.submit("manual");
  assert.equal(result.body.result.integrityInvalidated, true); assert.equal(result.body.result.score, null); assert.equal(f.state.exp, 0);
});

test("mobile resume plays a paused valid stream and restarts media/detectors for ended tracks", async () => {
  let plays = 0; let stopped = 0;
  const video = { paused: true, play: async () => { plays++; } };
  const stream = { getVideoTracks: () => [{ readyState: "live" }], getTracks: () => [{ stop: () => { stopped++; } }] };
  assert.equal(runtime.resumeProctoredMedia(stream, video), false); assert.equal(plays, 1); assert.equal(stopped, 0);
  stream.getVideoTracks = () => [{ readyState: "ended" }];
  assert.equal(runtime.resumeProctoredMedia(stream, video), true); assert.equal(stopped, 1); assert.equal(plays, 1);
  const source = fs.readFileSync("src/app/quiz/[id]/page.tsx", "utf8");
  assert.match(source, /setMediaGeneration\(\(generation\) => generation \+ 1\)/);
  assert.doesNotMatch(source, /loadedCocoModel\?\.dispose/);
});

test("result refresh preserves recorded score below three strikes and never awards EXP", async () => {
  const f = fixture(); f.state.attempt.quizStatus = "completed";
  f.db.studentQuiz.findMany = async () => [{ ...f.state.attempt, score: 67, aiVerdict: "cheated", _count: { violations: 2 } }];
  const get = f.load("dashboard/student/results").GET;
  for (let i = 0; i < 2; i++) {
    const response = await get(); assert.equal(response.body.results[0].score, 67); assert.equal(response.body.results[0].integrityInvalidated, false);
  }
  assert.equal(f.state.exp, 0);
});
