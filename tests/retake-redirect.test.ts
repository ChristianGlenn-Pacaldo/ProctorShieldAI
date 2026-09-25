import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { getApprovedRetakeDestination, getPendingRetakes, type RetakeEnrollment } from "../src/lib/retake-redirect.ts";

const source = (file: string) => fs.readFileSync(path.resolve(process.cwd(), file), "utf-8");

const pendingAttempt: RetakeEnrollment = {
  quizId: 42,
  attemptNumber: 1,
  quizStatus: "pending_retake",
  attemptMode: "proctored",
};

test("approved proctored retake redirects only after a new active attempt exists", () => {
  const pending = getPendingRetakes([pendingAttempt]);
  assert.equal(getApprovedRetakeDestination([pendingAttempt], pending), null);
  assert.equal(getApprovedRetakeDestination([{ ...pendingAttempt, quizStatus: "completed" }], pending), null);
  assert.equal(getApprovedRetakeDestination([
    { ...pendingAttempt, quizStatus: "completed" },
    { quizId: 42, attemptNumber: 2, quizStatus: "enrolled", attemptMode: "proctored" },
  ], pending), "/quiz/42");
});

test("approved arena retake uses Arena route and ignores unrelated attempts", () => {
  const pending = getPendingRetakes([{ ...pendingAttempt, quizId: 7 }]);
  assert.equal(getApprovedRetakeDestination([
    { quizId: 42, attemptNumber: 2, quizStatus: "enrolled", attemptMode: "proctored" },
    { quizId: 7, attemptNumber: 2, quizStatus: "in_progress", attemptMode: "arena" },
  ], pending), "/arena/7");
});

test("student layout owns one retake listener across dashboard and result pages", () => {
  const layout = source("src/app/dashboard/student/layout.tsx");
  const redirect = source("src/app/dashboard/student/retake-redirect.tsx");
  const quizzes = source("src/app/dashboard/student/quizzes/content.tsx");
  const approval = source("src/app/api/quizzes/retake/approve/route.ts");

  assert.match(layout, /<RetakeRedirect userId=\{session\.userId\} \/>/);
  assert.match(redirect, /channel\.bind\("retake-decision"/);
  assert.match(redirect, /getApprovedRetakeDestination\(enrollments, pendingRetakes\)/);
  assert.match(redirect, /window\.setInterval/);
  assert.doesNotMatch(quizzes, /retake-decision/);
  assert.match(approval, /quizMode: studentQuiz\.attemptMode/);
});
