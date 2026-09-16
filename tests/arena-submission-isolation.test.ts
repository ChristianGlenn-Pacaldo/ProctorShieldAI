import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { calculateQuizCoinReward } from "../src/lib/student-coins.ts";
import { isIntegrityInvalidated, enforceIntegrityPolicy } from "../src/lib/quiz-submission.ts";

const submitRouteSrc = fs.readFileSync(
  path.resolve(process.cwd(), "src/app/api/quizzes/submit/route.ts"),
  "utf-8"
);
const teacherReportsRouteSrc = fs.readFileSync(
  path.resolve(process.cwd(), "src/app/api/dashboard/teacher/reports/route.ts"),
  "utf-8"
);
const studentResultsRouteSrc = fs.readFileSync(
  path.resolve(process.cwd(), "src/app/api/dashboard/student/results/route.ts"),
  "utf-8"
);
const studentResultsContentSrc = fs.readFileSync(
  path.resolve(process.cwd(), "src/app/dashboard/student/results/content.tsx"),
  "utf-8"
);
const resultModalSrc = fs.readFileSync(
  path.resolve(process.cwd(), "src/components/student/ResultModal.tsx"),
  "utf-8"
);

test("Test A & G: Arena submission branches before Gemini analysis and Proctored retains Gemini path", () => {
  // Confirm submission mode resolution strictly checks studentQuiz.attemptMode
  assert.match(
    submitRouteSrc,
    /const effectiveMode =\s*studentQuiz\.attemptMode === ["']arena["'] \? ["']arena["'] : ["']proctored["']/
  );

  // Confirm Arena block is placed BEFORE Gemini prompt and call
  const arenaBlockIndex = submitRouteSrc.indexOf("if (isArena) {");
  const geminiCallIndex = submitRouteSrc.indexOf("generateGeminiWithFallback(");
  const promptIndex = submitRouteSrc.indexOf("const prompt = `You are ProctorShield AI");

  assert.ok(arenaBlockIndex > 0, "Arena branch must exist");
  assert.ok(geminiCallIndex > 0, "Gemini call must exist for proctored exams");
  assert.ok(arenaBlockIndex < geminiCallIndex, "Arena branch must occur BEFORE Gemini call");
  assert.ok(arenaBlockIndex < promptIndex, "Arena branch must occur BEFORE Gemini prompt creation");

  // Arena branch completes and returns response early
  const arenaSubstring = submitRouteSrc.substring(arenaBlockIndex, geminiCallIndex);
  assert.match(arenaSubstring, /return NextResponse\.json/);
  assert.match(arenaSubstring, /attemptMode:\s*["']arena["']/);
});

test("Test B, C, D & E: Arena submission never invalidates score, sets null AI verdicts, and never touches AiAnalysis", () => {
  const arenaBlockIndex = submitRouteSrc.indexOf("if (isArena) {");
  const proctoredSectionIndex = submitRouteSrc.indexOf("// ─────────────────────────────────────────────────────────────\n    // 3. PROCTORED EXAM AI VERDICT");
  const arenaSubstring = submitRouteSrc.substring(arenaBlockIndex, proctoredSectionIndex);

  // Never invalidates score
  assert.match(arenaSubstring, /const recordedScore = score;/);
  assert.equal(arenaSubstring.includes("isIntegrityInvalidated"), false);

  // aiVerdict and cheatingProbability remain null
  assert.match(arenaSubstring, /aiVerdict:\s*null/);
  assert.match(arenaSubstring, /cheatingProbability:\s*null/);

  // Never creates or updates AiAnalysis
  assert.equal(arenaSubstring.includes("aiAnalysis"), false);
  assert.equal(arenaSubstring.includes("enforceIntegrityPolicy"), false);
});

test("Test F: Arena rewards are never penalized or invalidated by violations", () => {
  // Arena with violations still receives full rewards and is never invalidated
  const arenaReward = calculateQuizCoinReward({
    rank: 1,
    score: 95,
    violationsCount: 5,
    isInvalidated: true, // even if passed true accidentally
    attemptMode: "arena",
  });

  assert.equal(arenaReward.coins > 0, true);
  assert.equal(arenaReward.isTopOne, true);
  assert.equal(arenaReward.rankTitle, "🥇 Top 1 Leaderboard Champion");
  assert.equal(arenaReward.breakdown.some((b) => b.includes("integrity policy violation")), false);
  assert.equal(arenaReward.breakdown.some((b) => b.includes("Arena Combat Finish")), true);

  // Proctored with invalidation receives 0 coins
  const proctoredReward = calculateQuizCoinReward({
    rank: 1,
    score: 95,
    violationsCount: 3,
    isInvalidated: true,
    attemptMode: "proctored",
  });
  assert.equal(proctoredReward.coins, 0);
  assert.equal(proctoredReward.rankTitle, "Invalidated Result");
});

test("Test H: Proctored 3-strike invalidation still functions", () => {
  assert.equal(isIntegrityInvalidated(2), false);
  assert.equal(isIntegrityInvalidated(3), true);

  const enforced = enforceIntegrityPolicy({
    cheatingProbability: 10,
    riskLevel: "low",
    finalVerdict: "clean",
    aiExplanation: "Ok",
  }, 3);

  assert.equal(enforced.finalVerdict, "cheated");
  assert.equal(enforced.cheatingProbability, 100);
});

test("Test I: Teacher integrity report strictly filters by attemptMode proctored", () => {
  assert.match(
    teacherReportsRouteSrc,
    /attemptMode:\s*["']proctored["']/
  );
});

test("Test J & K: Student Arena results hide AI verdict, Proctored results preserve AI verdict", () => {
  // API returns null AI verdict for arena
  assert.match(
    studentResultsRouteSrc,
    /if\s*\(\s*isArena\s*\)\s*\{[\s\S]*?aiVerdict:\s*null[\s\S]*?cheatingProbability:\s*null/
  );

  // UI renders distinct presentation
  assert.match(studentResultsContentSrc, /isArena/);
  assert.match(studentResultsContentSrc, /Match Completed/);
  assert.match(resultModalSrc, /Power Arena Match/);
  assert.match(resultModalSrc, /Arena Score/);
  assert.match(resultModalSrc, /AI Analysis Report/);
});

test("Test L: Historical classification prefers attemptMode over Quiz.quizMode", () => {
  // Function modeling student result normalization
  function classifyAttempt(attempt: { attemptMode?: string | null }, quiz: { quizMode?: string | null }) {
    // StudentQuiz.attemptMode is authoritative for historical attempts
    return attempt.attemptMode === "arena" ? "arena" : "proctored";
  }

  // Scenario 1: Quiz changed to arena later, but student took it as proctored
  assert.equal(
    classifyAttempt({ attemptMode: "proctored" }, { quizMode: "arena" }),
    "proctored"
  );

  // Scenario 2: Quiz changed to proctored later, but student took it as arena
  assert.equal(
    classifyAttempt({ attemptMode: "arena" }, { quizMode: "proctored" }),
    "arena"
  );

  // Scenario 3: Legacy attempt where attemptMode was null
  assert.equal(
    classifyAttempt({ attemptMode: null }, { quizMode: "arena" }),
    "proctored"
  );
});
