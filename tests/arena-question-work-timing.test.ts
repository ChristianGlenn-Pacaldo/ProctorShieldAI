import assert from "node:assert/strict";
import test from "node:test";
import { readArenaQuestionWork } from "../src/lib/arena-question-work.ts";

type WorkDatabase = Parameters<typeof readArenaQuestionWork>[0];
const questions = [{ id: 1 }, { id: 2 }, { id: 3 }];
const deadline = Date.parse("2026-10-07T08:00:00.000Z");

function database(onRead = () => {}) {
  return {
    setting: { findUnique: async () => { onRead(); return null; } },
    answer: { findMany: async () => [{ questionId: 1, answerText: "11", isCorrect: false }] },
  } as unknown as WorkDatabase;
}

test("Arena question work closes at the exact match deadline without changing answer counts", async () => {
  for (const now of [deadline - 1, deadline, deadline + 1]) {
    const { work } = await readArenaQuestionWork(database(), "attempt", "session", questions, false, {
      matchEndsAt: new Date(deadline).toISOString(), now,
    });
    assert.equal(work.isFinished, now >= deadline);
    assert.equal(work.nextWork === null, now >= deadline);
    assert.equal(work.wrongCount, 1);
    assert.equal(work.correctCount, 0);
    assert.equal(work.originalAnswered, 1);
    assert.equal(work.totalQuestions, 3);
  }
});

test("missing or invalid Arena deadlines preserve open work and existing callers", async () => {
  const existing = (await readArenaQuestionWork(database(), "attempt", "session", questions)).work;
  assert.equal(existing.isFinished, false);
  for (const matchEndsAt of [undefined, null, "", "invalid"]) {
    const { work } = await readArenaQuestionWork(database(), "attempt", "session", questions, false, { matchEndsAt, now: deadline });
    assert.deepEqual(work, existing);
  }
});

test("explicit quiz/attempt closure overrides a future Arena deadline", async () => {
  const { work } = await readArenaQuestionWork(database(), "attempt", "session", questions, true, {
    matchEndsAt: new Date(deadline).toISOString(), now: deadline - 1,
  });
  assert.equal(work.isFinished, true);
  assert.equal(work.nextWork, null);
  assert.equal(work.wrongCount, 1);
});

test("Arena deadline is captured before asynchronous reads cross its boundary", async t => {
  let now = deadline - 1;
  t.mock.method(Date, "now", () => now);
  const { work } = await readArenaQuestionWork(database(() => { now = deadline + 1; }), "attempt", "session", questions, false, {
    matchEndsAt: new Date(deadline).toISOString(),
  });
  assert.equal(work.isFinished, false);
  assert.notEqual(work.nextWork, null);
});
