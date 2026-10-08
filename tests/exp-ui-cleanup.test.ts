import assert from "node:assert/strict";
import test from "node:test";
import { visibleStudentNotifications } from "../src/lib/notification-presentation.ts";
import { podiumHtml, playgroundHtml, quizCompletionHtml } from "./helpers/exp-ui-fixture.ts";
import { fixture, textOf } from "./helpers/dashboard-lifecycle-fixture.ts";

const retired = /EXP Earned|Student Progression|Level Progression|Classroom EXP|Total EXP/i;
const notice = (id: string, title: string, message = "+100 EXP Earned!") => ({
  id, title, message, isRead: false, createdAt: "2026-10-08T00:00:00Z", actionUrl: "/dashboard/student/results",
});

test("actual Arena podium omits EXP while retaining match points, ranks, streak and leaderboard", () => {
  const html = podiumHtml();
  assert.doesNotMatch(html, retired);
  assert.match(html, /Your Points/); assert.match(html, /1234/); assert.match(html, /950/);
  assert.match(html, /Max Streak/); assert.match(html, /7X/); assert.match(html, /Leaderboard/);
  assert.match(html, /grid-cols-2 gap-3 text-center/);
});

for (const violations of [0, 1, 3]) test(`actual quiz completion (${violations} violations) retains its score/integrity and navigation without EXP`, () => {
  const html = quizCompletionHtml(violations);
  assert.doesNotMatch(html, retired);
  assert.match(html, /Exam Score/); assert.match(html, /Questions Completed/);
  assert.match(html, /Back to Dashboard/);
  assert.match(html, violations >= 3 ? /Not recorded/ : /75%/);
  assert.match(html, violations >= 3 ? /CHEATED/ : violations ? /REVIEW/ : /Guardian Verified Submission/);
});

for (const pro of [false, true]) test(`actual Teacher Playground ${pro ? "Pro" : "Free"} preserves launch/paywall controls without EXP feature advertising`, () => {
  const html = playgroundHtml(pro);
  assert.doesNotMatch(html, retired);
  assert.match(html, pro ? /Launch Arena Game/ : /Upgrade to Pro/);
  assert.match(html, pro ? /Meteors \(-100 PTS\)/ : /Projector Command Center/);
  if (!pro) assert.match(html, /md:grid-cols-2/);
});

test("legacy EXP/level notices are hidden without mutating stored data or hiding scores and monitoring levels", () => {
  const rows = [notice("1", "STUDENT PROGRESSION"), notice("2", "EXP Earned!"), notice("3", "Level Up!"),
    notice("4", "+100 EXP Earned!"), notice("5", "Experience Points"), notice("6", "Level 2 Reached"),
    notice("7", "Arena Match Completed", 'You completed "EXP Basics". Score: 1234 points. +100 EXP Earned!'),
    notice("8", "AI Proctoring Report Ready", "Risk Level: Low. 2 violations."),
    notice("9", "Quiz Completed", 'You completed "Level Up!". Score: 75%.'),
    notice("10", "Student joined quiz", "Monitoring Level: Reduced Assurance")];
  const before = structuredClone(rows);
  const visible = visibleStudentNotifications(rows);
  assert.deepEqual(visible.map(row => row.id), ["7", "8", "9", "10"]);
  assert.equal(visible[0].message, 'You completed "EXP Basics". Score: 1234 points.');
  assert.equal(visible[2].message, 'You completed "Level Up!". Score: 75%.');
  assert.match(visible[1].message, /Risk Level: Low/);
  assert.deepEqual(rows, before);
});

test("legacy completion reward clauses disappear while academic and gameplay points remain", () => {
  const visible = visibleStudentNotifications([
    notice("1", "Quiz Completed", 'You completed "QA". Score: 75%. You earned 100 EXP. You leveled up to Level 2!'),
    notice("2", "Arena Match Completed", "Score: 1234 points. Max streak: 7. +200 XP Earned!"),
  ]);
  assert.doesNotMatch(visible.map(row => row.message).join(" "), /\bEXP\b|\bXP\b|leveled up/i);
  assert.match(visible[0].message, /Score: 75%/); assert.match(visible[1].message, /1234 points/);
});

for (const role of ["student", "teacher"] as const) test(`actual ${role} shell filters obsolete progression during load, poll and realtime refresh`, async () => {
  const setup = fixture(role);
  const rows = [notice("old", "Student Progression"), notice("result", "Quiz Completed", "Score: 75%. +100 EXP Earned!"),
    notice("alert", "AI Proctoring Report Ready", "Risk Level: Low")];
  setup.queue("/api/notifications", { body: { success: true, notifications: rows, unreadCount: 3 } });
  setup.render(); await setup.ready();
  assert.equal(setup.notificationCount(), 2);
  assert.equal(textOf(setup.bell()), "2");
  await setup.bell().props.onClick(); await setup.ready();
  assert.doesNotMatch(textOf(setup.render()), retired);
  setup.queue("/api/notifications", { body: { success: true, notifications: [notice("old", "Level Up!")], unreadCount: 1 } });
  await setup.advance(15_000);
  assert.equal(setup.notificationCount(), 0);
  setup.queue("/api/notifications", { body: { success: true, notifications: rows, unreadCount: 3 } });
  setup.shellCallback("notification")(); await setup.ready();
  assert.equal(setup.notificationCount(), 2);
  setup.unmount(); setup.assertDisposed();
});
