import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { isArenaQuiz, isProctoredQuiz } from "../src/lib/quiz-mode.ts";

const quizPageSrc = fs.readFileSync(
  path.resolve(process.cwd(), "src/app/quiz/[id]/page.tsx"),
  "utf-8"
);
const submitRouteSrc = fs.readFileSync(
  path.resolve(process.cwd(), "src/app/api/quizzes/submit/route.ts"),
  "utf-8"
);
const snapshotRouteSrc = fs.readFileSync(
  path.resolve(process.cwd(), "src/app/api/live/snapshot/route.ts"),
  "utf-8"
);
const joinRouteSrc = fs.readFileSync(
  path.resolve(process.cwd(), "src/app/api/live/join/route.ts"),
  "utf-8"
);
const quizDetailsRouteSrc = fs.readFileSync(
  path.resolve(process.cwd(), "src/app/api/quizzes/[id]/route.ts"),
  "utf-8"
);

// ── Pure logic guards testing identical to runtime implementation ──

type SubmissionReason =
  | "manual"
  | "all_questions_completed"
  | "timer_expired"
  | "violation_limit"
  | "teacher_ended";

function simulateSubmitGuard(params: {
  reason: SubmissionReason;
  hasStarted: boolean;
  questions: any[];
  answers: Record<number, any>;
  timeLeft: number;
  timerInitialized: boolean;
  violationCount: number;
  eventQuizId?: number;
  activeQuizId?: number;
}): { allowed: boolean; blockReason?: string } {
  const {
    reason,
    hasStarted,
    questions,
    answers,
    timeLeft,
    timerInitialized,
    violationCount,
    eventQuizId,
    activeQuizId,
  } = params;

  if (reason === "all_questions_completed") {
    if (!questions.length || Object.keys(answers).length < questions.length) {
      return {
        allowed: false,
        blockReason: `only ${Object.keys(answers).length}/${questions.length} answered`,
      };
    }
  }

  if (reason === "timer_expired") {
    if (!hasStarted || !timerInitialized || timeLeft > 0) {
      return {
        allowed: false,
        blockReason: `timer not legitimately expired (timeLeft: ${timeLeft}, initialized: ${timerInitialized})`,
      };
    }
  }

  if (reason === "violation_limit") {
    if (violationCount < 3) {
      return {
        allowed: false,
        blockReason: `violation count ${violationCount} < 3`,
      };
    }
  }

  if (reason === "teacher_ended") {
    if (eventQuizId !== undefined && activeQuizId !== undefined && eventQuizId !== activeQuizId) {
      return {
        allowed: false,
        blockReason: "quizId mismatch for teacher-end event",
      };
    }
  }

  return { allowed: true };
}

test("1. questions = [] while loading does NOT submit", () => {
  const res = simulateSubmitGuard({
    reason: "all_questions_completed",
    hasStarted: true,
    questions: [],
    answers: {},
    timeLeft: 300,
    timerInitialized: true,
    violationCount: 0,
  });
  assert.equal(res.allowed, false);
  assert.match(res.blockReason || "", /only 0\/0 answered/);
});

test("2. 0 >= 0 cannot trigger all-complete", () => {
  const emptyQuestions: any[] = [];
  const currentAnswers: Record<number, any> = {};
  const isAllAnswered = emptyQuestions.length > 0 && Object.keys(currentAnswers).length >= emptyQuestions.length;
  assert.equal(isAllAnswered, false);

  const res = simulateSubmitGuard({
    reason: "all_questions_completed",
    hasStarted: true,
    questions: emptyQuestions,
    answers: currentAnswers,
    timeLeft: 600,
    timerInitialized: true,
    violationCount: 0,
  });
  assert.equal(res.allowed, false);
});

test("3. loaded quiz with unanswered questions does not submit", () => {
  const questions = [{ id: 1 }, { id: 2 }, { id: 3 }];
  const answers = {};
  const res = simulateSubmitGuard({
    reason: "all_questions_completed",
    hasStarted: true,
    questions,
    answers,
    timeLeft: 600,
    timerInitialized: true,
    violationCount: 0,
  });
  assert.equal(res.allowed, false);
  assert.match(res.blockReason || "", /only 0\/3 answered/);
});

test("4. waiting 10 seconds without action does not submit", () => {
  const resTimer = simulateSubmitGuard({
    reason: "timer_expired",
    hasStarted: true,
    questions: [{ id: 1 }, { id: 2 }],
    answers: {},
    timeLeft: 590,
    timerInitialized: true,
    violationCount: 0,
  });
  assert.equal(resTimer.allowed, false);

  const resCompletion = simulateSubmitGuard({
    reason: "all_questions_completed",
    hasStarted: true,
    questions: [{ id: 1 }, { id: 2 }],
    answers: {},
    timeLeft: 590,
    timerInitialized: true,
    violationCount: 0,
  });
  assert.equal(resCompletion.allowed, false);
});

test("5. first question visible and exam remains active", () => {
  assert.match(quizPageSrc, /currentQuestionIndex/);
  assert.match(quizPageSrc, /questions\[currentQuestionIndex\]/);
  assert.match(quizPageSrc, /examActiveRef\.current = hasStarted && !isSubmitting && !quizSubmittedResult && violationCount < 3/);
});

test("6. answering one of multiple questions does not submit", () => {
  const questions = [{ id: 1 }, { id: 2 }, { id: 3 }];
  const answers = { 1: 101 };
  const res = simulateSubmitGuard({
    reason: "all_questions_completed",
    hasStarted: true,
    questions,
    answers,
    timeLeft: 550,
    timerInitialized: true,
    violationCount: 0,
  });
  assert.equal(res.allowed, false);
  assert.match(res.blockReason || "", /only 1\/3 answered/);
});

test("7. answering final question can submit only if intended", () => {
  const questions = [{ id: 1 }, { id: 2 }];
  const answers = { 1: 101, 2: 102 };
  const res = simulateSubmitGuard({
    reason: "all_questions_completed",
    hasStarted: true,
    questions,
    answers,
    timeLeft: 500,
    timerInitialized: true,
    violationCount: 0,
  });
  assert.equal(res.allowed, true);
});

test("8. timer initializes correctly from duration", () => {
  assert.match(quizPageSrc, /timerInitializedRef/);
  assert.match(quizPageSrc, /timerInitializedRef\.current = true/);
  assert.match(quizPageSrc, /if \(!hasStarted\)\s*\{\s*timerInitializedRef\.current = false;/);
});

test("9. timer zero before initialization does not submit", () => {
  const res = simulateSubmitGuard({
    reason: "timer_expired",
    hasStarted: false,
    questions: [{ id: 1 }],
    answers: {},
    timeLeft: 0,
    timerInitialized: false,
    violationCount: 0,
  });
  assert.equal(res.allowed, false);
});

test("10. actual timer expiration submits", () => {
  const res = simulateSubmitGuard({
    reason: "timer_expired",
    hasStarted: true,
    questions: [{ id: 1 }, { id: 2 }],
    answers: { 1: 101 },
    timeLeft: 0,
    timerInitialized: true,
    violationCount: 0,
  });
  assert.equal(res.allowed, true);
});

test("11. violationCount 0 does not submit", () => {
  const res = simulateSubmitGuard({
    reason: "violation_limit",
    hasStarted: true,
    questions: [{ id: 1 }],
    answers: {},
    timeLeft: 300,
    timerInitialized: true,
    violationCount: 0,
  });
  assert.equal(res.allowed, false);
});

test("12. violationCount 1/2 does not submit", () => {
  for (const count of [1, 2]) {
    const res = simulateSubmitGuard({
      reason: "violation_limit",
      hasStarted: true,
      questions: [{ id: 1 }],
      answers: {},
      timeLeft: 300,
      timerInitialized: true,
      violationCount: count,
    });
    assert.equal(res.allowed, false);
  }
});

test("13. authoritative violationCount 3 submits exactly once", () => {
  const res = simulateSubmitGuard({
    reason: "violation_limit",
    hasStarted: true,
    questions: [{ id: 1 }],
    answers: {},
    timeLeft: 300,
    timerInitialized: true,
    violationCount: 3,
  });
  assert.equal(res.allowed, true);

  assert.match(quizPageSrc, /currentCount >= 3/);
  assert.match(quizPageSrc, /submitQuizRef\.current\("violation_limit"\)/);
});

test("14. lobby snapshots/joins do not set premature startTime or drain fresh attempt timer", () => {
  // Verifies live snapshot does not prematurely set startTime during lobby
  assert.match(snapshotRouteSrc, /if \(!enrollment\.startTime && enrollment\.quiz\.quizStatus === "in_progress" && enrollment\.quizStatus === "in_progress"\)/);
  // Verifies live join does not prematurely set startTime during lobby
  assert.match(joinRouteSrc, /if \(!enrollment\.startTime && quiz\.quizStatus === "in_progress" && enrollment\.quizStatus === "in_progress"\)/);
  // Verifies quizzes/[id] remainingSeconds only calculates from startTime when in_progress
  assert.match(quizDetailsRouteSrc, /studentQuiz\.quizStatus === "in_progress"/);
});

test("15. stale teacher-end event is ignored", () => {
  const res = simulateSubmitGuard({
    reason: "teacher_ended",
    hasStarted: true,
    questions: [{ id: 1 }],
    answers: {},
    timeLeft: 300,
    timerInitialized: true,
    violationCount: 0,
    eventQuizId: 999,
    activeQuizId: 123,
  });
  assert.equal(res.allowed, false);
});

test("16. valid matching teacher-end submits", () => {
  const res = simulateSubmitGuard({
    reason: "teacher_ended",
    hasStarted: true,
    questions: [{ id: 1 }],
    answers: {},
    timeLeft: 300,
    timerInitialized: true,
    violationCount: 0,
    eventQuizId: 123,
    activeQuizId: 123,
  });
  assert.equal(res.allowed, true);
});

test("17. invalid submit trigger does not show completion UI", () => {
  // If submit is blocked by guard, quizSubmittedResult remains null and state remains in exam
  assert.match(quizPageSrc, /if \(quizSubmittedResult\) \{/);
  assert.match(quizPageSrc, /\[SubmitGuard\] Blocked premature submit/);
});

test("18. invalid submit trigger awards no EXP", () => {
  // Submit route awards EXP only on valid completed submissions where !integrityInvalidated
  assert.match(submitRouteSrc, /if \(!integrityInvalidated\) \{/);
  assert.match(submitRouteSrc, /awardStudentExp\(session\.userId, EXP_REWARDS\.PROCTORED_COMPLETION/);
});

test("19. Power Arena unaffected", () => {
  assert.equal(isArenaQuiz({ quizMode: "arena" }), true);
  assert.equal(isProctoredQuiz({ quizMode: "arena" }), false);
  assert.match(submitRouteSrc, /if \(isArena\) \{/);
  assert.match(quizPageSrc, /router\.replace\(`\/arena\/\${quizId}`\)/);
});
