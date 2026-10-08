import assert from "node:assert/strict";
import test from "node:test";
import { averageExamScore, studentResultState, type StudentResultRecord } from "../src/lib/student-result-summary.ts";
import { gradeSubmission } from "../src/lib/quiz-submission.ts";

const completed = (score: number | string | null, extra: Partial<StudentResultRecord> = {}): StudentResultRecord => ({
  attemptMode: "proctored", quizStatus: "completed", endTime: "2026-10-08T10:00:00Z",
  score, _count: { violations: 0 }, ...extra,
});

test("213 Arena points are never interpreted as an exam percentage", () => {
  const arena = completed(213, { attemptMode: "arena" });
  assert.equal(averageExamScore([arena]), 0);
  assert.equal(averageExamScore([completed(80), arena]), 80);
  assert.equal(arena.score, 213, "the gameplay score is preserved");
});

test("already-normalized weighted exam grades are averaged without a second conversion", () => {
  const grade = gradeSubmission([
    { id: 1, points: 30, choices: [{ id: 11, isCorrect: true }] },
    { id: 2, points: 10, choices: [{ id: 21, isCorrect: true }] },
  ], [{ questionId: 1, choiceId: 11 }]);
  assert.equal(grade.score, 75);
  assert.equal(averageExamScore([completed(grade.score), completed(100)]), 88);
});

test("historical attempt mode takes precedence over a quiz's subsequently changed mode", () => {
  const rows = [
    { ...completed(60), quiz: { quizMode: "arena" } },
    { ...completed(213, { attemptMode: "arena" }), quiz: { quizMode: "proctored" } },
    completed(80, { attemptMode: null }),
  ];
  assert.equal(averageExamScore(rows), 70);
});

test("exams with different maximum points are averaged as normalized percentages", () => {
  const scores = [
    gradeSubmission([{ id: 1, points: 3, choices: [{ id: 11, isCorrect: true }] },
      { id: 2, points: 1, choices: [{ id: 21, isCorrect: true }] }], [{ questionId: 1, choiceId: 11 }]).score,
    gradeSubmission([{ id: 3, points: 50, choices: [{ id: 31, isCorrect: true }] },
      { id: 4, points: 50, choices: [{ id: 41, isCorrect: true }] }], [{ questionId: 3, choiceId: 31 }]).score,
  ];
  assert.deepEqual(scores, [75, 50]);
  assert.equal(averageExamScore(scores.map(score => completed(score))), 63);
});

test("distinct completed retakes and previous pending-retake attempts retain Results semantics", () => {
  const rows = [
    { ...completed(60, { quizStatus: "pending_retake" }), id: "first", quizId: 42, attemptNumber: 1 },
    { ...completed(90), id: "retake", quizId: 42, attemptNumber: 2 },
    { ...completed(null, { quizStatus: "enrolled", endTime: null }), id: "next", quizId: 42, attemptNumber: 3 },
    { ...completed(75), id: "other", quizId: 43, attemptNumber: 1 },
  ];
  const before = structuredClone(rows);
  assert.equal(averageExamScore(rows), 75);
  assert.deepEqual(rows, before, "summarizing does not rewrite or remove academic records");
});

test("three-strike invalidated exams are excluded while Arena points are not voided", () => {
  const invalidated = completed(100, { _count: { violations: 3 } });
  assert.equal(studentResultState(invalidated).integrityInvalidated, true);
  assert.equal(averageExamScore([completed(70, { _count: { violations: 2 } }), invalidated,
    completed(95, { integrityInvalidated: true })]), 70);
  const arena = completed(213, { attemptMode: "arena", _count: { violations: 3 } });
  assert.equal(studentResultState(arena).integrityInvalidated, false);
  assert.equal(arena.score, 213);
});

test("an AI risk label alone does not void an academic score, matching Results", () => {
  const reviewed = { ...completed(80, { _count: { violations: 2 } }), aiVerdict: "cheated" };
  assert.equal(averageExamScore([reviewed]), 80);
});

test("unfinished, rejected, null-score and non-finite records do not inflate the average", () => {
  assert.equal(averageExamScore([
    completed(100, { endTime: null }), completed(100, { quizStatus: "in_progress" }),
    completed(100, { quizStatus: "rejected" }), completed(null), completed(NaN),
    completed(Infinity), completed("not-a-number"), completed("80"),
  ]), 80);
  assert.equal(averageExamScore([]), 0);
});

test("the summary does not conceal unexpected historical exam scores by clamping", () => {
  assert.equal(averageExamScore([completed(120)]), 120);
});
