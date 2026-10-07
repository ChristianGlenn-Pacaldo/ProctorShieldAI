import fs from "node:fs";
import { loadArenaModule } from "./arena-fixture.ts";
import * as grading from "../../src/lib/quiz-submission.ts";
import * as runtime from "../../src/lib/proctored-runtime.ts";
import * as devices from "../../src/lib/device-capabilities.ts";
import * as quizMode from "../../src/lib/quiz-mode.ts";
import * as availability from "../../src/lib/quiz-availability.ts";
import * as access from "../../src/lib/quiz-access.ts";
import * as retakes from "../../src/lib/retake-eligibility.ts";

export function quizSessionFixture(duration = 30) {
  let now = Date.parse("2026-10-05T10:00:00Z");
  class ServerDate extends Date {
    constructor(value?: any) { super(value === undefined ? now : value); }
    static now() { return now; }
  }
  const quiz = { id: 7, teacherId: "teacher", title: "Shared quiz", duration, quizStatus: "active", quizMode: "proctored", allowRetake: true,
    questions: [{ id: 1, points: 1, questionType: "multiple_choice", choices: [{ id: 10, choiceText: "A", isCorrect: true }, { id: 11, choiceText: "B", isCorrect: false }] }],
    _count: { questions: 1 }, subject: { subjectName: "Science" } };
  let state: any = { quizzes: new Map([[7, quiz]]), attempts: new Map(), settings: new Map(), answers: [], violations: [], notifications: [], exp: 0 };
  let next = 0;
  const matches = (row: any, where: any): boolean => Object.entries(where ?? {}).every(([key, value]: [string, any]) => {
    if (key === "quiz") return matches(state.quizzes.get(row.quizId), value);
    if (value && typeof value === "object" && !(value instanceof Date)) {
      if ("not" in value) return row[key] !== value.not;
      if ("in" in value) return value.in.includes(row[key]);
      if ("notIn" in value) return !value.notIn.includes(row[key]);
    }
    return row[key] === value;
  });
  const result = (row: any) => row ? { ...structuredClone(row), quiz: structuredClone(state.quizzes.get(row.quizId)), student: { fullName: row.studentId },
    violations: structuredClone(state.violations.filter((v: any) => v.studentQuizId === row.id)) } : null;
  const db: any = {
    $executeRaw: async () => 1,
    quiz: {
      findUnique: async ({ where }: any) => structuredClone(state.quizzes.get(where.id)),
      updateMany: async ({ where, data }: any) => { let count = 0; for (const row of state.quizzes.values()) if (matches(row, where)) { Object.assign(row, data); count++; } return { count }; },
      update: async ({ where, data }: any) => Object.assign(state.quizzes.get(where.id), data),
    },
    studentQuiz: {
      findUnique: async ({ where }: any) => result(state.attempts.get(where.id)),
      findFirst: async ({ where, orderBy }: any) => {
        const rows = [...state.attempts.values()].filter((row: any) => matches(row, where));
        if (orderBy) { const [key, direction] = Object.entries(orderBy)[0]; rows.sort((a: any, b: any) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0) * (direction === "desc" ? -1 : 1)); }
        return result(rows[0]);
      },
      findMany: async ({ where }: any = {}) => [...state.attempts.values()].filter((row: any) => matches(row, where)).map(result),
      count: async ({ where }: any) => [...state.attempts.values()].filter((row: any) => matches(row, where)).length,
      create: async ({ data }: any) => { const row = { id: `attempt-${++next}`, attemptNumber: 1, attemptMode: "proctored", startTime: null, endTime: null, score: null, monitoringLevel: "strict", ...structuredClone(data) }; state.attempts.set(row.id, row); return result(row); },
      updateMany: async ({ where, data }: any) => { let count = 0; for (const row of state.attempts.values()) if (matches(row, where)) { Object.assign(row, data); count++; } return { count }; },
      update: async ({ where, data }: any) => { Object.assign(state.attempts.get(where.id), data); return result(state.attempts.get(where.id)); },
    },
    setting: {
      findUnique: async ({ where }: any) => structuredClone(state.settings.get(where.settingKey) ?? null),
      create: async ({ data }: any) => { if(state.settings.has(data.settingKey)) throw Error("duplicate setting"); state.settings.set(data.settingKey, structuredClone(data)); return data; },
      upsert: async ({ where, create, update }: any) => { const row = state.settings.get(where.settingKey); const saved = row ? { ...row, ...update } : create; state.settings.set(where.settingKey, structuredClone(saved)); return saved; },
    },
    question: { findMany: async ({ where }: any) => structuredClone(state.quizzes.get(where.quizId).questions), count: async () => 1 },
    choice: { findMany: async () => [{ id: 10, questionId: 1 }], findFirst: async () => ({ id: 10, isCorrect: true, question: { points: 1 } }) },
    answer: { count: async () => state.answers.length, findMany: async ({ where }: any) => structuredClone(state.answers.filter((a: any) => a.studentQuizId === where.studentQuizId)),
      deleteMany: async ({ where }: any) => { state.answers = state.answers.filter((a: any) => a.studentQuizId !== where.studentQuizId); },
      createMany: async ({ data }: any) => { state.answers.push(...structuredClone(data)); },
      findUnique: async () => null, upsert: async ({ create }: any) => { state.answers.push(structuredClone(create)); return create; } },
    violation: { findMany: async ({ where }: any) => structuredClone(state.violations.filter((v: any) => v.studentQuizId === where.studentQuizId)), count: async () => 0 },
    notification: { create: async ({ data }: any) => { state.notifications.push(data); return data; }, createMany: async ({ data }: any) => { state.notifications.push(...data); } },
    aiAnalysis: { upsert: async () => {} },
  };
  let tail = Promise.resolve();
  db.$transaction = async (work: any) => { const prior=tail; let release!: () => void; tail=new Promise<void>(r=>{ release=r; }); await prior; const saved=structuredClone(state); try { return await work(db); } catch(error) { state=saved; throw error; } finally { release(); } };
  const timing = fs.existsSync("src/lib/quiz-session-timing.ts") ? loadArenaModule("src/lib/quiz-session-timing.ts", { __Date: ServerDate }) : {};
  const arena = loadArenaModule("src/lib/arena.ts", { __Date: ServerDate, "./prisma.ts": { __esModule: true, default: db }, "./redis.ts": { getRedis: () => null, isRedisReady: () => false }, "./student-identity.ts": { getStudentInitials: () => "ST" } });
  const deps: any = { __Date: ServerDate,
    "next/server": { NextResponse: { json: (body: any, options: any = {}) => ({ status: options.status ?? 200, body }) } },
    "@/lib/prisma": { __esModule: true, default: db }, "@prisma/client": {},
    "@/lib/quiz-mode": quizMode, "@/lib/quiz-availability": availability, "@/lib/quiz-access": access,
    "@/lib/device-capabilities": devices, "@/lib/retake-eligibility": retakes, "@/lib/quiz-submission": grading, "@/lib/proctored-runtime": runtime,
    "@/lib/quiz-session-timing": timing,
    "@/lib/pusher": { pusherServer: { trigger: async () => {} }, arenaPusher: { trigger: async () => {} } },
    "@/lib/backup-write-gate": { withBackupWriteGate: (handler: unknown) => handler },
    "@/lib/gemini": {}, "@/lib/arena": arena, "@/lib/arena-finalization": { recoverArenaFinalization: async () => {} },
    "@/lib/student-progression": { EXP_REWARDS: { PROCTORED_COMPLETION: 100 }, awardStudentExp: async (_id: string, amount: number) => { state.exp += amount; return { expAwarded: amount }; }, getStudentProgression: async () => ({}) },
  };
  deps["@/lib/arena-realtime"] = loadArenaModule("src/lib/arena-realtime.ts", { __Date: ServerDate, "./arena.ts": arena, "@/lib/pusher": deps["@/lib/pusher"] });
  const load = (route: string, userId: string, role = "student") => loadArenaModule(`src/app/api/${route}/route.ts`, { ...deps, "@/lib/auth": { getSession: async () => ({ userId, role, fullName: userId }) } });
  const request = (body: any) => ({ json: async () => body, headers: { get: () => null } });
  return { db, timing, deps, get state() { return state; }, now: () => now, advance: (minutes: number) => { now += minutes * 60_000; },
    add: (studentId: string, quizId=7) => db.studentQuiz.create({ data: { studentId, quizId, quizStatus: "enrolled" } }),
    end: (quizId=7) => load("quizzes/[id]", "teacher", "teacher").PUT(request({ quizStatus: "ended" }), { params: Promise.resolve({ id: String(quizId) }) }),
    teacherStart: (quizId=7) => load("quizzes/[id]/start", "teacher", "teacher").POST(request({}), { params: Promise.resolve({ id: String(quizId) }) }),
    start: (id: string) => { const a=state.attempts.get(id); return load("quizzes/session", a.studentId).POST(request({ action: "start", quizId: a.quizId, studentQuizId: id })); },
    get: (studentId: string, quizId=7) => load("quizzes/[id]", studentId).GET(request({}), { params: Promise.resolve({ id: String(quizId) }) }),
    submit: (id: string, reason: string) => { const a=state.attempts.get(id); return load("quizzes/submit", a.studentId).POST(request({ quizId: a.quizId, studentQuizId: id, reason, answers: [] })); },
    retake: (id: string) => load("quizzes/retake", state.attempts.get(id).studentId).POST(request({ studentQuizId: id })),
    approve: (id: string) => load("quizzes/retake/approve", "teacher", "teacher").POST(request({ studentQuizId: id, action: "accept" })),
    answer: (id: string) => { const a=state.attempts.get(id); return load("quizzes/answer", a.studentId).POST(request({ quizId: a.quizId, studentQuizId: id, questionId: 1, choiceId: 10 })); },
    autosave: (id: string) => { const a=state.attempts.get(id); return load("quizzes/autosave", a.studentId).POST(request({ quizId: a.quizId, studentQuizId: id, answers: [{ questionId: 1, choiceId: 10 }] })); },
  };
}
