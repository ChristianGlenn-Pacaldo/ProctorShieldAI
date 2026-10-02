import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as access from "../src/lib/quiz-access.ts";
import * as mode from "../src/lib/quiz-mode.ts";
import * as availability from "../src/lib/quiz-availability.ts";
import { gradeSubmission } from "../src/lib/quiz-submission.ts";

const authored = Array.from({ length: 10 }, (_, i) => ({
  id: 11 + i * 3, questionText: `Question ${i + 1}`, questionType: "multiple_choice", points: i + 1,
  choices: Array.from({ length: 4 }, (_, j) => ({ id: 101 + i * 7 + j, choiceText: `Choice ${j + 1}`, isCorrect: j === 0 })),
}));
type Question = typeof authored[number];
type Payload = { studentQuizId: string; questions: Question[]; savedAnswers: { questionId: number; choiceId: number; isCorrect: boolean }[] };

function load(file: string, db: unknown, role = "student") {
  const exports: Record<string, (...args: unknown[]) => Promise<Response>> = {};
  const dependencies: Record<string, unknown> = {
    "node:crypto": crypto,
    "next/server": { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } },
    "@/lib/backup-write-gate": { withBackupWriteGate: (handler: unknown) => handler },
    "@/lib/auth": { getSession: async () => ({ userId: role === "student" ? "student-1" : "teacher-1", role }) },
    "@/lib/prisma": { __esModule: true, default: db },
    "@/lib/arena": {}, "@/lib/quiz-access": access, "@/lib/quiz-mode": mode,
    "@/lib/quiz-availability": availability, "@/lib/pusher": { pusherServer: { trigger: async () => {} } },
  };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, {
    exports, Date, console,
    require: (name: string) => { assert.ok(name in dependencies, name); return dependencies[name]; },
  });
  return exports;
}

function fixture(shuffleQuestions = true) {
  let rows = structuredClone(authored);
  const quiz = { id: 7, teacherId: "teacher-1", quizMode: "proctored", quizStatus: "in_progress", duration: 30, shuffleQuestions };
  const attempts = [{ id: "attempt-student-1", studentId: "student-1", quizId: 7, attemptNumber: 1,
    attemptMode: "proctored", quizStatus: "in_progress", startTime: new Date(), endTime: null as Date | null }];
  let saved: { questionId: number; answerText: string; isCorrect: boolean }[] = [];
  const db = {
    quiz: { findUnique: async (query: { include: { questions: { orderBy: { id: string }; include: { choices: { orderBy: { id: string } } } } } }) => {
      assert.equal(query.include.questions.orderBy.id, "asc");
      assert.equal(query.include.questions.include.choices.orderBy.id, "asc");
      // Intentionally ignore orderBy: the canonical shuffle boundary must also
      // survive the same logical relation returned in any physical input order.
      return { ...quiz, questions: rows };
    } },
    studentQuiz: {
      findFirst: async (query: { orderBy: { attemptNumber: string } }) => {
        assert.equal(query.orderBy.attemptNumber, "desc"); return attempts.at(-1);
      },
      findUnique: async () => ({ ...attempts[0], quiz, student: { fullName: "Student" } }),
      updateMany: async () => { attempts[0].quizStatus = "completed"; return { count: 1 }; },
      create: async ({ data }: { data: Omit<typeof attempts[number], "id"> }) => {
        const attempt = { ...data, id: crypto.randomUUID() }; attempts.push(attempt); return attempt;
      },
    },
    answer: { findMany: async () => saved }, violation: { count: async () => 0 },
    notification: { create: async () => {} }, $executeRaw: async () => 1,
    $transaction: async (callback: (tx: unknown) => unknown) => callback(db),
  };
  const route = load("src/app/api/quizzes/[id]/route.ts", db);
  return {
    attempts, db, quiz,
    input: (next: Question[]) => { rows = next; },
    save: (next: typeof saved) => { saved = next; },
    get: async () => {
      const response = await route.GET(new Request("https://test/api/quizzes/7"), { params: Promise.resolve({ id: "7" }) });
      assert.equal(response.status, 200); assert.match(response.headers.get("cache-control")!, /no-store/);
      return await response.json() as Payload;
    },
  };
}
const ids = (payload: Payload) => payload.questions.map(q => q.id);
const sequences = (payload: Payload) => payload.questions.map(q => [q.id, q.choices.map(c => c.id)]);
const reverseInput = () => structuredClone(authored).reverse().map(q => ({ ...q, choices: q.choices.reverse() }));

test("same attempt canonicalizes reversed question/choice DB inputs before seeded shuffle", async () => {
  const f = fixture(); const first = await f.get(); f.input(reverseInput());
  assert.deepEqual(sequences(await f.get()), sequences(first));
});
test("refresh/reconnect retains exact question and choice sequence without mutating database input", async () => {
  const f = fixture(); const original = structuredClone(authored); f.input(original);
  const first = await f.get();
  for (let i = 0; i < 4; i++) assert.deepEqual(sequences(await f.get()), sequences(first));
  assert.deepEqual(original, authored);
});
test("independent Student attempts use their own seed; permutation collisions are permitted", async () => {
  const f = fixture();
  // Golden sequences from the existing attempt-ID/Mulberry32 algorithm.
  // Assert each seed's contract rather than a uniqueness rule across Students.
  const expected = {
    "student-A-attempt": [23, 17, 11, 32, 38, 14, 35, 26, 29, 20],
    "student-B-attempt": [35, 17, 32, 29, 38, 11, 23, 14, 26, 20],
    "student-C-attempt": [29, 32, 35, 11, 20, 17, 23, 26, 14, 38],
  };
  for (const [id, sequence] of Object.entries(expected)) {
    f.attempts[0].id = id; f.input(authored); const first = await f.get();
    assert.deepEqual(ids(first), sequence);
    f.input(reverseInput()); const next = await f.get();
    assert.equal(next.studentQuizId, id); assert.deepEqual(sequences(next), sequences(first));
    assert.deepEqual(ids(next).sort((a, b) => a - b), authored.map(q => q.id));
  }
});
test("shuffle disabled preserves canonical persisted question and choice creation order", async () => {
  const f = fixture(false); f.input(reverseInput()); const data = await f.get();
  assert.deepEqual(ids(data), authored.map(q => q.id));
  assert.deepEqual(data.questions.map(q => q.choices.map(c => c.id)), authored.map(q => q.choices.map(c => c.id)));
});
test("choice-only physical order changes keep the same attempt/question choice seed stable", async () => {
  const f = fixture(); const first = await f.get();
  f.input(authored.map(q => ({ ...q, choices: [...q.choices].reverse() })));
  assert.deepEqual(sequences(await f.get()), sequences(first));
  assert.ok(first.questions.every(q => q.choices.every(c => !("isCorrect" in c))), "Student responses must not reveal grading keys");
});
test("display positions cannot change correctness or score; answers remain question/choice IDs", async () => {
  const f = fixture(); const data = await f.get();
  const answers = data.questions.map(q => ({ questionId: q.id, choiceId: authored.find(original => original.id === q.id)!.choices[0].id }));
  const first = gradeSubmission(authored, answers);
  const reordered = gradeSubmission(reverseInput(), [...answers].reverse());
  assert.equal(first.score, 100); assert.equal(reordered.score, 100);
  assert.deepEqual(reordered.records.sort((a, b) => a.questionId - b.questionId), first.records);
  const wrong = answers.map(a => ({ ...a, choiceId: authored.find(q => q.id === a.questionId)!.choices[1].id }));
  assert.equal(gradeSubmission(reverseInput(), wrong).score, 0);
});
test("actual approved retake creates a new attempt seed and keeps its own stable sequence", async () => {
  const f = fixture(); const original = await f.get();
  f.attempts[0].quizStatus = "pending_retake"; f.attempts[0].endTime = new Date();
  const approve = load("src/app/api/quizzes/retake/approve/route.ts", f.db, "teacher");
  const response = await approve.POST(new Request("https://test/api/quizzes/retake/approve", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ studentQuizId: original.studentQuizId, action: "accept" }),
  }));
  assert.equal(response.status, 200); const retake = await f.get();
  assert.notEqual(retake.studentQuizId, original.studentQuizId);
  assert.equal(f.attempts[1].attemptNumber, 2); f.input(reverseInput());
  assert.deepEqual(sequences(await f.get()), sequences(retake));
});
test("resume returns locked answers by IDs even when input relation order changes", async () => {
  const f = fixture(); const first = await f.get(); const question = first.questions[2];
  const correct = authored.find(q => q.id === question.id)!.choices[0];
  f.save([{ questionId: question.id, answerText: String(correct.id), isCorrect: true }]);
  f.input(reverseInput()); const resumed = await f.get();
  assert.deepEqual(sequences(resumed), sequences(first));
  assert.deepEqual(resumed.savedAnswers, [{ questionId: question.id, choiceId: correct.id, isCorrect: true }]);
  assert.ok(resumed.questions.find(q => q.id === question.id)!.choices.some(c => c.id === resumed.savedAnswers[0].choiceId));
});
