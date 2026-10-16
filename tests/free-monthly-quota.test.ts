import assert from "node:assert/strict";
import test from "node:test";
import * as rules from "../src/lib/subscription-rules.ts";
import { loadArenaModule } from "./helpers/arena-fixture.ts";

type Quiz = { teacherId: string; isAiGenerated: boolean; createdAt: Date };
type Activity = { userId: string; activity: string; createdAt: Date };
type Range = { gte: Date; lt: Date };
const inRange = (date: Date, range: Range) => date >= range.gte && date < range.lt;

function fixture(quizzes: Quiz[] = [], activities: Activity[] = [], proUntil?: Date) {
  const db = {
    userSubscription: { findFirst: async ({ where }: { where: { endDate: { gt: Date } } }) =>
      proUntil && proUntil > where.endDate.gt ? { endDate: proUntil, plan: { planName: "Premium Monthly" } } : null },
    quiz: { count: async ({ where }: { where: { teacherId: string; isAiGenerated: boolean; createdAt: Range } }) =>
      quizzes.filter(quiz => quiz.teacherId === where.teacherId && quiz.isAiGenerated === where.isAiGenerated && inRange(quiz.createdAt, where.createdAt)).length },
    activityLog: { count: async ({ where }: { where: { userId: string; createdAt: Range; OR: { activity: { startsWith: string } }[] } }) =>
      activities.filter(activity => activity.userId === where.userId && inRange(activity.createdAt, where.createdAt)
        && where.OR.some(condition => activity.activity.startsWith(condition.activity.startsWith))).length },
  };
  const service = loadArenaModule("src/lib/teacher-entitlements.ts", {
    "@/lib/prisma": { default: db, __esModule: true }, "@/lib/subscription-rules": rules,
  });
  return { quizzes, activities, read: (now: Date) => service.getTeacherEntitlements("owner", db, now) };
}

test("Free quota uses calendar months at UTC+8, including leap years and year rollover", () => {
  const cases = [
    ["2026-10-31T15:59:59.999Z", "2026-09-30T16:00:00.000Z", "2026-10-31T16:00:00.000Z"],
    ["2026-10-31T16:00:00.000Z", "2026-10-31T16:00:00.000Z", "2026-11-30T16:00:00.000Z"],
    ["2026-12-31T16:00:00.000Z", "2026-12-31T16:00:00.000Z", "2027-01-31T16:00:00.000Z"],
    ["2028-02-29T12:00:00.000Z", "2028-01-31T16:00:00.000Z", "2028-02-29T16:00:00.000Z"],
  ];
  for (const [now, start, end] of cases) {
    const actual = rules.getFreeQuizQuotaWindow(new Date(now));
    assert.equal(actual.start.toISOString(), start);
    assert.equal(actual.end.toISOString(), end);
  }
});

test("five used quizzes block a sixth and reset automatically at the next calendar month", async () => {
  const createdAt = new Date("2026-10-15T04:00:00Z");
  const setup = fixture(Array.from({ length: 5 }, () => ({ teacherId: "owner", isAiGenerated: false, createdAt })),
    Array.from({ length: 5 }, (_, i) => ({ userId: "owner", activity: `Created manual quiz: ${i}`, createdAt })));
  const october = await setup.read(new Date("2026-10-31T15:59:59.999Z"));
  assert.equal(october.manualQuizCount, 5);
  assert.equal(october.manualQuizzesRemaining, 0);
  assert.equal(rules.getQuizCreationDecision(october, false).allowed, false);
  const november = await setup.read(new Date("2026-10-31T16:00:00.000Z"));
  assert.equal(november.manualQuizCount, 0);
  assert.equal(november.manualQuizzesRemaining, 5);
  assert.equal(rules.getQuizCreationDecision(november, false).allowed, true);
});

test("deleting current-month quizzes preserves usage, without double counting surviving quizzes", async () => {
  const createdAt = new Date("2026-10-16T00:00:00Z");
  const setup = fixture([{ teacherId: "owner", isAiGenerated: false, createdAt }],
    Array.from({ length: 5 }, (_, i) => ({ userId: "owner", activity: `Created manual quiz: ${i}`, createdAt })));
  assert.equal((await setup.read(createdAt)).manualQuizCount, 5);
  setup.quizzes.length = 0;
  assert.equal((await setup.read(createdAt)).manualQuizCount, 5);
});

test("monthly usage excludes another teacher, AI quizzes, edits, prior and next months", async () => {
  const now = new Date("2026-10-16T00:00:00Z"), first = new Date("2026-09-30T16:00:00Z");
  const setup = fixture([
    { teacherId: "owner", isAiGenerated: false, createdAt: first },
    { teacherId: "owner", isAiGenerated: true, createdAt: now },
    { teacherId: "other", isAiGenerated: false, createdAt: now },
    { teacherId: "owner", isAiGenerated: false, createdAt: new Date(first.getTime() - 1) },
    { teacherId: "owner", isAiGenerated: false, createdAt: new Date("2026-10-31T16:00:00Z") },
  ], [
    { userId: "owner", activity: "Created quiz: legacy format", createdAt: first },
    { userId: "owner", activity: "Created AI quiz: sample", createdAt: now },
    { userId: "owner", activity: "Edited quiz: sample", createdAt: now },
    { userId: "other", activity: "Created manual quiz: sample", createdAt: now },
    { userId: "owner", activity: "Created manual quiz: previous", createdAt: new Date(first.getTime() - 1) },
    { userId: "owner", activity: "Created manual quiz: next", createdAt: new Date("2026-10-31T16:00:00Z") },
  ]);
  const result = await setup.read(now);
  assert.equal(result.manualQuizCount, 1);
  assert.equal(result.manualQuizzesRemaining, 4);
  assert.equal(result.studentLimitPerQuiz, 20);
  assert.equal(rules.getQuizCreationDecision(result, true).allowed, false);
});

test("legacy unlogged quizzes count in their creation month; Pro remains unlimited", async () => {
  const now = new Date("2026-10-16T00:00:00Z");
  const quizzes = Array.from({ length: 8 }, () => ({ teacherId: "owner", isAiGenerated: false, createdAt: now }));
  const free = await fixture(quizzes).read(now);
  assert.equal(free.manualQuizCount, 8);
  assert.equal(free.manualQuizzesRemaining, 0);
  const pro = await fixture(quizzes, [], new Date("2026-11-01T00:00:00Z")).read(now);
  assert.equal(pro.manualQuizLimit, null);
  assert.equal(pro.manualQuizzesRemaining, null);
  assert.equal(pro.studentLimitPerQuiz, 100);
  assert.equal(rules.getQuizCreationDecision(pro, false).allowed, true);
  assert.equal(rules.getQuizCreationDecision(pro, true).allowed, true);
});

test("invalid quota dates fail closed", () => {
  assert.throws(() => rules.getFreeQuizQuotaWindow(new Date("invalid")), RangeError);
});
