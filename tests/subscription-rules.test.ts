import assert from "node:assert/strict";
import test from "node:test";
import {
  FREE_MANUAL_QUIZ_LIMIT,
  FREE_STUDENT_LIMIT_PER_QUIZ,
  PRO_STUDENT_LIMIT_PER_QUIZ,
  PRO_MONTHLY_PRICE_PHP,
  PRO_SUBSCRIPTION_DURATION_DAYS,
  getQuizCapacityDecision,
  getQuizCreationDecision,
  type TeacherEntitlementSummary,
} from "../src/lib/subscription-rules.ts";

function entitlements(
  overrides: Partial<TeacherEntitlementSummary> = {},
): TeacherEntitlementSummary {
  return {
    isSubscribed: false,
    planName: "Free Tier",
    subscriptionEndsAt: null,
    manualQuizCount: 0,
    manualQuizLimit: FREE_MANUAL_QUIZ_LIMIT,
    manualQuizzesRemaining: FREE_MANUAL_QUIZ_LIMIT,
    studentLimitPerQuiz: FREE_STUDENT_LIMIT_PER_QUIZ,
    ...overrides,
  };
}

test("free teachers can create their first five manual quizzes", () => {
  for (let count = 0; count < FREE_MANUAL_QUIZ_LIMIT; count += 1) {
    assert.deepEqual(
      getQuizCreationDecision(entitlements({ manualQuizCount: count }), false),
      { allowed: true },
    );
  }
});

test("the paid plan is ₱500 for 30 days", () => {
  assert.equal(PRO_MONTHLY_PRICE_PHP, 500);
  assert.equal(PRO_SUBSCRIPTION_DURATION_DAYS, 30);
});

test("free teachers cannot create a sixth manual quiz", () => {
  const decision = getQuizCreationDecision(
    entitlements({ manualQuizCount: FREE_MANUAL_QUIZ_LIMIT, manualQuizzesRemaining: 0 }),
    false,
  );

  assert.equal(decision.allowed, false);
  if (!decision.allowed) assert.equal(decision.code, "FREE_QUIZ_LIMIT_REACHED");
});

test("free teachers cannot save AI-generated quizzes", () => {
  const decision = getQuizCreationDecision(entitlements(), true);

  assert.equal(decision.allowed, false);
  if (!decision.allowed) assert.equal(decision.code, "SUBSCRIPTION_REQUIRED");
});

test("active Pro teachers have unlimited manual and AI quiz creation", () => {
  const pro = entitlements({
    isSubscribed: true,
    planName: "Premium Monthly",
    subscriptionEndsAt: new Date("2030-01-01T00:00:00.000Z"),
    manualQuizCount: 10_000,
    manualQuizLimit: null,
    manualQuizzesRemaining: null,
    studentLimitPerQuiz: PRO_STUDENT_LIMIT_PER_QUIZ,
  });

  assert.deepEqual(getQuizCreationDecision(pro, false), { allowed: true });
  assert.deepEqual(getQuizCreationDecision(pro, true), { allowed: true });
});

test("free quizzes allow up to 20 distinct students", () => {
  assert.deepEqual(getQuizCapacityDecision(false, 19), {
    allowed: true,
    limit: FREE_STUDENT_LIMIT_PER_QUIZ,
    remaining: 1,
  });

  const full = getQuizCapacityDecision(false, 20);
  assert.equal(full.allowed, false);
  if (!full.allowed) {
    assert.equal(full.code, "QUIZ_CAPACITY_REACHED");
    assert.equal(full.limit, FREE_STUDENT_LIMIT_PER_QUIZ);
  }
});

test("Pro quizzes allow up to 100 distinct students", () => {
  assert.deepEqual(getQuizCapacityDecision(true, 99), {
    allowed: true,
    limit: PRO_STUDENT_LIMIT_PER_QUIZ,
    remaining: 1,
  });

  const full = getQuizCapacityDecision(true, 100);
  assert.equal(full.allowed, false);
  if (!full.allowed) assert.equal(full.limit, PRO_STUDENT_LIMIT_PER_QUIZ);
});
