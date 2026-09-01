import assert from "node:assert/strict";
import test from "node:test";
import {
  fallbackVerdict,
  gradeSubmission,
  normalizeSubmittedAnswers,
  parseVerdict,
} from "../src/lib/quiz-submission.ts";

const questions = [
  { id: 1, points: 2, choices: [{ id: 10, isCorrect: true }, { id: 11, isCorrect: false }] },
  { id: 2, points: 3, choices: [{ id: 20, isCorrect: false }, { id: 21, isCorrect: true }] },
];

test("submitted answers are integer-only and deduplicated per question", () => {
  assert.deepEqual(
    normalizeSubmittedAnswers([
      { questionId: 1, choiceId: 10 },
      { questionId: 1, choiceId: 11 },
      { questionId: "2", choiceId: 21 },
      null,
    ]),
    [{ questionId: 1, choiceId: 11 }],
  );
});

test("grading ignores choices that do not belong to the quiz question", () => {
  const result = gradeSubmission(questions, [
    { questionId: 1, choiceId: 10 },
    { questionId: 2, choiceId: 999 },
  ]);
  assert.equal(result.score, 40);
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].isCorrect, true);
});

test("empty quizzes cannot receive random fallback scores", () => {
  assert.throws(() => gradeSubmission([], []), /no questions/i);
});

test("AI verdicts are accepted only within the strict verdict contract", () => {
  const fallback = fallbackVerdict(1);
  assert.deepEqual(parseVerdict({ cheatingProbability: 999, finalVerdict: "clean" }, fallback), fallback);
  assert.deepEqual(
    parseVerdict({
      cheatingProbability: 12.4,
      riskLevel: "low",
      finalVerdict: "clean",
      aiExplanation: "Evidence reviewed.",
    }, fallback),
    {
      cheatingProbability: 12,
      riskLevel: "low",
      finalVerdict: "clean",
      aiExplanation: "Evidence reviewed.",
    },
  );
});
