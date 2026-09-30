import fs from "node:fs";
import vm from "node:vm";
import crypto from "node:crypto";
import ts from "typescript";
import assert from "node:assert/strict";
import * as grading from "../../src/lib/quiz-submission.ts";
import * as quizMode from "../../src/lib/quiz-mode.ts";

const compiled = new Map<string, string>();
export function loadArenaModule(file: string, dependencies: Record<string, unknown>) {
  if (!compiled.has(file)) compiled.set(file, ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText);
  const exports: any = {};
  vm.runInNewContext(compiled.get(file)!, {
    exports, Date, Map, Set, Promise, Buffer, crypto, structuredClone,
    setTimeout, process: { env: {} }, console: { error(...args: unknown[]) { (dependencies.__diagnostics as unknown[][] | undefined)?.push(args); }, warn() {} },
    require: (name: string) => {
      if (name === "node:crypto") return crypto;
      if (!(name in dependencies)) throw new Error(`Missing dependency ${name}`);
      return dependencies[name];
    },
  });
  return exports;
}

/** Transactions begin concurrently. Only executing the actual advisory-lock
 * statement serializes them; staged records are published at commit. */
export function arenaFixture(status: "active" | "lobby" = "active") {
  const settings = new Map<string, { settingKey: string; settingValue: string }>();
  let data: any = {
    settings, answers: new Map(),
    quiz: { id: 77, teacherId: "teacher", quizMode: "arena", quizStatus: status === "active" ? "in_progress" : "active",
      title: "Fixture", totalQuestions: 2, questions: [1, 2].map((id) => ({ id, choices: [{ isCorrect: true }, { isCorrect: false }] })), _count: { questions: 2 } },
    attempts: new Map(["a", "b", "c"].map((id) => [id, { id: `attempt-${id}`, studentId: id, quizId: 77,
      attemptNumber: 1, attemptMode: "arena", quizStatus: "in_progress", startTime: new Date(), endTime: null }])),
  };
  let lockTail = Promise.resolve();
  let failure = "";
  let redisFailure = false;
  let pusherFailure = false;
  let transactions = 0;
  let lockGate: { enter: () => void; resume: Promise<void> } | undefined;
  const timeline: string[] = [];
  const events: Array<{ event: string; data: any }> = [];
  const errors: unknown[][] = [];
  const committed = new Set<number>();
  const matches = (row: any, where: any) => Object.entries(where).every(([key, expected]: [string, any]) => {
    if (key === "quiz") return true;
    if (expected && typeof expected === "object") {
      if (expected.in) return expected.in.includes(row[key]);
      if (expected.notIn) return !expected.notIn.includes(row[key]);
      if (expected.not) return row[key] !== expected.not;
      return true;
    }
    return row[key] === expected;
  });
  const db: any = {
    $transaction: async (operation: (tx: any) => Promise<any>) => {
      transactions++;
      let release: (() => void) | undefined;
      let local: any;
      const fail = (name: string) => { if (failure === name) { failure = ""; throw new Error(`injected ${name} failure`); } };
      const ready = () => { assert.ok(local, "authoritative reads must follow the advisory lock"); return local; };
      const tx: any = {
        $executeRaw: async (_sql: TemplateStringsArray, key: string) => {
          timeline.push(`lock:${key}`);
          if (local) return 1;
          assert.equal(key, "arena-state:77", "Arena lock must precede answer/progression locks");
          const previous = lockTail;
          lockTail = new Promise<void>((resolve) => { release = resolve; });
          await previous;
          local = structuredClone(data);
          const gate = lockGate;
          lockGate = undefined;
          if (gate) { gate.enter(); await gate.resume; }
          return 1;
        },
        setting: {
          findUnique: async ({ where }: any) => { fail("read"); return ready().settings.get(where.settingKey) ?? null; },
          upsert: async ({ where, update, create }: any) => {
            fail(where.settingKey.startsWith("arena:state:") ? "state" : "progression");
            const current = ready().settings.get(where.settingKey);
            const record = current ? { ...current, ...update } : { ...create };
            local.settings.set(where.settingKey, record); return structuredClone(record);
          },
          create: async ({ data: record }: any) => { fail("marker"); ready().settings.set(record.settingKey, structuredClone(record)); return record; },
          deleteMany: async ({ where }: any) => { ready().settings.delete(where.settingKey); },
        },
        quiz: {
          findUnique: async () => structuredClone(ready().quiz),
          update: async ({ data: update }: any) => { fail("quiz"); Object.assign(ready().quiz, update); return local.quiz; },
          updateMany: async ({ where, data: update }: any) => {
            if (!matches(ready().quiz, where)) return { count: 0 };
            Object.assign(local.quiz, update); return { count: 1 };
          },
        },
        studentQuiz: {
          count: async ({ where }: any) => [...ready().attempts.values()].filter((a) => matches(a, where)).length,
          findFirst: async ({ where }: any) => {
            const row = [...ready().attempts.values()].find((a) => matches(a, where));
            return row ? { ...structuredClone(row), quiz: { ...structuredClone(local.quiz), duration: 30 } } : null;
          },
          findMany: async ({ where }: any) => [...ready().attempts.values()].filter((a) => matches(a, where)),
          updateMany: async ({ where, data: update }: any) => {
            fail("attempt"); let count = 0;
            for (const row of ready().attempts.values()) if (matches(row, where)) { Object.assign(row, update); count++; }
            return { count };
          },
          update: async ({ where, data: update }: any) => {
            const row: any = [...ready().attempts.values()].find((a: any) => a.id === where.id);
            Object.assign(row, update); return row;
          },
        },
        choice: { findFirst: async ({ where }: any) => ({ id: where.id, isCorrect: true, question: { points: 100 } }) },
        answer: {
          findMany: async ({ where }: any) => [...ready().answers.values()].filter((row: any) => row.studentQuizId === where.studentQuizId && row.isCorrect != null),
          findUnique: async ({ where }: any) => ready().answers.get(JSON.stringify(where.studentQuizId_questionId)) ?? null,
          upsert: async ({ where, create }: any) => { fail("answer"); ready().answers.set(JSON.stringify(where.studentQuizId_questionId), structuredClone(create)); return create; },
          deleteMany: async ({ where }: any) => { for (const [key, row] of ready().answers) if (row.studentQuizId === where.studentQuizId) local.answers.delete(key); },
          createMany: async ({ data: rows }: any) => { for (const row of rows) ready().answers.set(JSON.stringify({ studentQuizId: row.studentQuizId, questionId: row.questionId }), structuredClone(row)); },
        },
        notification: { createMany: async () => {} },
      };
      try {
        const result = await operation(tx);
        fail("commit");
        data = local;
        const state = JSON.parse(data.settings.get("arena:state:77")?.settingValue ?? "null");
        if (state?.revision) committed.add(state.revision);
        timeline.push("commit");
        return result;
      } catch (error) { timeline.push("rollback"); throw error; }
      finally { release?.(); }
    },
  };
  db.studentQuiz = { findFirst: async ({ where }: any) => {
    const row = [...data.attempts.values()].find((a) => matches(a, where));
    return row ? { ...structuredClone(row), violations: [], quiz: { ...structuredClone(data.quiz), duration: 30 } } : null;
  } };
  db.quiz = { findUnique: async () => structuredClone(data.quiz) };
  db.activityLog = { create: async () => {} };
  db.question = { findMany: async () => [1, 2].map((id) => ({ id, points: 100, questionType: "multiple_choice", choices: [{ id: id * 10, isCorrect: true }] })) };
  db.answer = { findMany: async ({ where }: any) => [...data.answers.values()].filter((row: any) => row.studentQuizId === where.studentQuizId && row.isCorrect != null) };
  db.choice = { findMany: async () => [{ id: 10, questionId: 1 }, { id: 20, questionId: 2 }] };
  db.setting = { findUnique: async ({ where }: any) => data.settings.get(where.settingKey) ?? null };
  const arena = loadArenaModule("src/lib/arena.ts", {
    "./prisma.ts": { __esModule: true, default: db },
    "./redis.ts": { getRedis: () => ({ del: async () => { timeline.push("cache"); if (redisFailure) throw new Error("cache unavailable"); } }), isRedisReady: () => true },
    "./student-identity.ts": { getStudentInitials: () => "ST" },
  });
  const initial = arena.createArenaState({ quizId: 77, teacherId: "teacher", status, totalQuestions: 2, sessionId: "session-1" });
  for (const id of ["a", "b", "c"]) arena.ensureArenaParticipant(initial, { studentId: id, studentName: id });
  data.settings.set("arena:state:77", { settingKey: "arena:state:77", settingValue: JSON.stringify(initial) });
  const pusher = { trigger: async (_channels: unknown, event: string, payload: any) => {
    if (payload.arenaRevision !== undefined) assert.ok(committed.has(payload.arenaRevision), "realtime must reference a committed revision");
    else assert.ok(timeline.includes("commit"), "submission notifications must follow commit");
    timeline.push(`event:${event}`);
    if (pusherFailure) throw new Error("pusher unavailable");
    events.push({ event, data: structuredClone(payload) });
  } };
  const realtime = loadArenaModule("src/lib/arena-realtime.ts", { "@/lib/pusher": { pusherServer: pusher } });
  const progression = loadArenaModule("src/lib/student-progression.ts", { "./prisma.ts": { __esModule: true, default: db } });
  const load = (file: string, userId: string, role = "student") => loadArenaModule(`src/app/api/${file}/route.ts`, {
    __diagnostics: errors,
    "next/server": { NextResponse: { json: (body: any, options: any = {}) => ({ status: options.status ?? 200, body: structuredClone(body) }) } },
    "@/lib/auth": { getSession: async () => ({ userId, role, fullName: userId }) },
    "@/lib/prisma": { __esModule: true, default: db },
    "@/lib/arena": arena, "@/lib/arena-realtime": realtime, "@/lib/student-progression": progression,
    "@/lib/pusher": { pusherServer: pusher }, "@/lib/security": {},
    "@/lib/quiz-mode": quizMode, "@/lib/quiz-access": {},
    "@/lib/quiz-submission": grading, "@/lib/proctored-runtime": {}, "@/lib/gemini": {},
    "@/lib/quiz-availability": { DELETED_QUIZ_STATUS: "deleted", isQuizAvailable: (s: string) => s !== "deleted", quizNotAvailableResponse: () => ({ error: "unavailable" }) },
    "@/lib/teacher-entitlements": { hasActiveProSubscription: async (_id: string, tx: unknown) => { assert.notEqual(tx, db); return true; } },
    "@/lib/backup-write-gate": { withBackupWriteGate: (handler: unknown) => handler, scheduleTrackedBackupWork: async () => {} },
  });
  const request = (body: object) => ({ json: async () => body, headers: { get: () => null } });
  return {
    arena, db, events, timeline, load, errors,
    restartRead: () => loadArenaModule("src/lib/arena.ts", {
      "./prisma.ts": { __esModule: true, default: db },
      "./redis.ts": { getRedis: () => null, isRedisReady: () => false },
      "./student-identity.ts": { getStudentInitials: () => "ST" },
    }).getArenaState(77, db),
    overlap: async (first: () => Promise<any>, ...others: Array<() => Promise<any>>) => {
      let enter!: () => void;
      let release!: () => void;
      const entered = new Promise<void>((resolve) => { enter = resolve; });
      const resume = new Promise<void>((resolve) => { release = resolve; });
      lockGate = { enter, resume };
      const leading = first();
      await entered;
      const followers = others.map((job) => job());
      release();
      return Promise.all([leading, ...followers]);
    },
    read: () => JSON.parse(data.settings.get("arena:state:77").settingValue),
    get data() { return data; }, get transactions() { return transactions; },
    fail: (name: string) => { failure = name; }, redisFailure: () => { redisFailure = true; }, pusherFailure: () => { pusherFailure = true; },
    save: (state: any) => data.settings.set("arena:state:77", { settingKey: "arena:state:77", settingValue: JSON.stringify(state) }),
    attack: (userId: string, powerType = "meteor", extra = {}) => load("arena/battle-action", userId).POST(request({ quizId: 77, sessionId: "session-1", powerType, targetStudentId: "c", ...extra })),
    answer: (userId: string, questionId = 1, extra = {}) => load("quizzes/answer", userId).POST(request({ quizId: 77, questionId, choiceId: questionId * 10, sessionId: "session-1", ...extra })),
    submit: (userId: string) => load("quizzes/submit", userId).POST(request({ quizId: 77, answers: [], sessionId: "session-1" })),
    autosave: (userId: string) => load("quizzes/autosave", userId).POST(request({ quizId: 77, answers: [{ questionId: 1, choiceId: 10 }], sessionId: "session-1" })),
    editQuiz: (body = { title: "Edited" }) => load("quizzes/[id]", "teacher", "teacher").PUT(request(body), { params: Promise.resolve({ id: "77" }) }),
    deleteQuiz: () => load("quizzes/[id]", "teacher", "teacher").DELETE(request({}), { params: Promise.resolve({ id: "77" }) }),
    legacyStart: () => load("quizzes/[id]/start", "teacher", "teacher").POST(request({}), { params: Promise.resolve({ id: "77" }) }),
    action: (action: string, userId = "teacher", extra = {}) => load("arena/[id]", userId, userId === "teacher" ? "teacher" : "student").POST(request({ action, ...extra }), { params: Promise.resolve({ id: "77" }) }),
    get: () => load("arena/[id]", "teacher", "teacher").GET(request({}), { params: Promise.resolve({ id: "77" }) }),
  };
}
