import assert from "node:assert/strict";
import test from "node:test";
import {
  QUIZ_MODES,
  InvalidQuizModeError,
  isQuizMode,
  parseQuizMode,
  isArenaQuiz,
  isProctoredQuiz,
  canChangeQuizMode,
} from "../src/lib/quiz-mode.ts";

test("quiz modes list contains only proctored and arena", () => {
  assert.deepEqual(QUIZ_MODES, ["proctored", "arena"]);
});

test("isQuizMode accurately verifies valid modes", () => {
  assert.equal(isQuizMode("proctored"), true);
  assert.equal(isQuizMode("arena"), true);
  assert.equal(isQuizMode("Arena"), false);
  assert.equal(isQuizMode("PROCTORED"), false);
  assert.equal(isQuizMode("game"), false);
  assert.equal(isQuizMode("standard"), false);
  assert.equal(isQuizMode(null), false);
  assert.equal(isQuizMode(undefined), false);
  assert.equal(isQuizMode(123), false);
});

test("parseQuizMode defaults undefined and null safely to proctored", () => {
  assert.equal(parseQuizMode(undefined), "proctored");
  assert.equal(parseQuizMode(null), "proctored");
});

test("parseQuizMode accepts valid explicit modes", () => {
  assert.equal(parseQuizMode("proctored"), "proctored");
  assert.equal(parseQuizMode("arena"), "arena");
});

test("parseQuizMode strictly rejects invalid explicit values, casing, and typos", () => {
  const invalidInputs = [
    "Arena",
    "ARENA",
    "arnea",
    "game",
    "standard",
    "proctor",
    "exam",
    "gamified",
    "",
    "   ",
    123,
    true,
    {},
    [],
  ];

  for (const input of invalidInputs) {
    assert.throws(
      () => parseQuizMode(input),
      (err: unknown) => {
        assert.ok(err instanceof InvalidQuizModeError);
        assert.equal((err as InvalidQuizModeError).code, "INVALID_QUIZ_MODE");
        assert.equal((err as InvalidQuizModeError).message, "Invalid quiz mode.");
        return true;
      },
      `Expected input "${String(input)}" to throw InvalidQuizModeError`
    );
  }
});

test("isArenaQuiz and isProctoredQuiz enforce single source of truth", () => {
  assert.equal(isArenaQuiz({ quizMode: "arena" }), true);
  assert.equal(isArenaQuiz({ quizMode: "proctored" }), false);
  assert.equal(isArenaQuiz(null), false);

  // Critical invariant: isGamified must NEVER make a quiz an Arena quiz
  const gamifiedProctored = { quizMode: "proctored", isGamified: true };
  assert.equal(isArenaQuiz(gamifiedProctored), false);
  assert.equal(isProctoredQuiz(gamifiedProctored), true);

  assert.equal(isProctoredQuiz({ quizMode: "proctored" }), true);
  assert.equal(isProctoredQuiz({ quizMode: "arena" }), false);
  assert.equal(isProctoredQuiz({ quizMode: undefined }), true);
  assert.equal(isProctoredQuiz(null), true);
});

test("Scenario A: changing mode from proctored to arena with 0 attempts in draft state is allowed", () => {
  const result = canChangeQuizMode({
    currentMode: "proctored",
    targetMode: "arena",
    attemptsCount: 0,
    quizStatus: "draft",
  });
  assert.equal(result.allowed, true);
});

test("Scenario B: changing mode from proctored to arena with attempts is rejected with QUIZ_MODE_CHANGE_NOT_ALLOWED", () => {
  const result = canChangeQuizMode({
    currentMode: "proctored",
    targetMode: "arena",
    attemptsCount: 1,
    quizStatus: "draft",
  });
  assert.equal(result.allowed, false);
  if (!result.allowed) {
    assert.equal(result.code, "QUIZ_MODE_CHANGE_NOT_ALLOWED");
    assert.equal(result.error, "Quiz mode cannot be changed after students have joined or attempted the quiz.");
  }
});

test("Scenario C: changing mode from arena to proctored with attempts is rejected with QUIZ_MODE_CHANGE_NOT_ALLOWED", () => {
  const result = canChangeQuizMode({
    currentMode: "arena",
    targetMode: "proctored",
    attemptsCount: 3,
    quizStatus: "active",
  });
  assert.equal(result.allowed, false);
  if (!result.allowed) {
    assert.equal(result.code, "QUIZ_MODE_CHANGE_NOT_ALLOWED");
    assert.equal(result.error, "Quiz mode cannot be changed after students have joined or attempted the quiz.");
  }
});

test("Scenario D: sending the same quizMode as currently stored is allowed as a no-op even with attempts and non-draft status", () => {
  const resultProctored = canChangeQuizMode({
    currentMode: "proctored",
    targetMode: "proctored",
    attemptsCount: 10,
    quizStatus: "ended",
  });
  assert.equal(resultProctored.allowed, true);

  const resultArena = canChangeQuizMode({
    currentMode: "arena",
    targetMode: "arena",
    attemptsCount: 5,
    quizStatus: "in_progress",
  });
  assert.equal(resultArena.allowed, true);
});

test("Scenario E: invalid explicit mode throws InvalidQuizModeError with code INVALID_QUIZ_MODE", () => {
  assert.throws(
    () => parseQuizMode("Arena"),
    (err: unknown) => {
      assert.ok(err instanceof InvalidQuizModeError);
      assert.equal((err as InvalidQuizModeError).code, "INVALID_QUIZ_MODE");
      return true;
    }
  );

  assert.throws(
    () => parseQuizMode("game"),
    (err: unknown) => {
      assert.ok(err instanceof InvalidQuizModeError);
      assert.equal((err as InvalidQuizModeError).code, "INVALID_QUIZ_MODE");
      return true;
    }
  );
});

test("changing mode when quiz is already active/started even with 0 attempts is rejected", () => {
  const result = canChangeQuizMode({
    currentMode: "proctored",
    targetMode: "arena",
    attemptsCount: 0,
    quizStatus: "active",
  });
  assert.equal(result.allowed, false);
  if (!result.allowed) {
    assert.equal(result.code, "QUIZ_MODE_CHANGE_NOT_ALLOWED");
  }
});
