import assert from "node:assert/strict";
import test from "node:test";
import {
  FREE_MANUAL_QUIZ_LIMIT,
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
    planName: "Premium Yearly",
    subscriptionEndsAt: new Date("2030-01-01T00:00:00.000Z"),
    manualQuizCount: 10_000,
    manualQuizLimit: null,
    manualQuizzesRemaining: null,
  });

  assert.deepEqual(getQuizCreationDecision(pro, false), { allowed: true });
  assert.deepEqual(getQuizCreationDecision(pro, true), { allowed: true });
});
