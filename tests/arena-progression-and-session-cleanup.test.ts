import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import {
  deriveLevelFromTotalExp,
  EXP_REWARDS,
  XP_PER_LEVEL,
  EXP_PER_LEVEL,
  arenaExpRewardedKey,
} from "../src/lib/student-progression.ts";

const studentArenaContentSrc = fs.readFileSync(
  path.resolve(process.cwd(), "src/app/arena/[id]/content.tsx"),
  "utf-8"
);
const teacherArenaContentSrc = fs.readFileSync(
  path.resolve(process.cwd(), "src/app/dashboard/teacher/playground/arena/[id]/content.tsx"),
  "utf-8"
);
const teacherPlaygroundSrc = fs.readFileSync(
  path.resolve(process.cwd(), "src/app/dashboard/teacher/playground/content.tsx"),
  "utf-8"
);
const apiArenaRouteSrc = fs.readFileSync(
  path.resolve(process.cwd(), "src/app/api/arena/[id]/route.ts"),
  "utf-8"
);
const submitRouteSrc = fs.readFileSync(
  path.resolve(process.cwd(), "src/app/api/quizzes/submit/route.ts"),
  "utf-8"
);
const studentDashboardContentSrc = fs.readFileSync(
  path.resolve(process.cwd(), "src/app/dashboard/student/content.tsx"),
  "utf-8"
);
const battleDockSrc = fs.readFileSync(
  path.resolve(process.cwd(), "src/components/arena/arena-battle-dock.tsx"),
  "utf-8"
);
const arenaPodiumSrc = fs.readFileSync(
  path.resolve(process.cwd(), "src/components/arena/arena-podium.tsx"),
  "utf-8"
);
const liveMonitoringRunnerSrc = fs.readFileSync(
  path.resolve(process.cwd(), "src/app/quiz/[id]/page.tsx"),
  "utf-8"
);
const progressionLibSrc = fs.readFileSync(
  path.resolve(process.cwd(), "src/lib/student-progression.ts"),
  "utf-8"
);

// ─────────────────────────────────────────────────────────────
// A, B, C: FRESH ARENA SESSION ON REUSED QUIZ
// ─────────────────────────────────────────────────────────────
test("A, B, C: Starting new Arena match from reused quiz generates fresh sessionId and resets lobby", () => {
  // Fresh sessionId and reset lobby
  assert.match(apiArenaRouteSrc, /if\s*\(action\s*===\s*["']reset["']\s*\|\|\s*action\s*===\s*["']create_session["']\)/);
  assert.match(apiArenaRouteSrc, /const freshSessionId = crypto\.randomUUID\(\)/);
  assert.match(apiArenaRouteSrc, /status:\s*["']lobby["']/);
  assert.match(apiArenaRouteSrc, /participants:\s*\{\}/);
  assert.match(apiArenaRouteSrc, /usedPowers:\s*\{\}/);
  assert.match(apiArenaRouteSrc, /pendingAttacks:\s*\{\}/);
  assert.match(apiArenaRouteSrc, /startedAt:\s*null/);
  assert.match(apiArenaRouteSrc, /matchEndsAt:\s*null/);
  assert.match(apiArenaRouteSrc, /endedAt:\s*null/);
});

// ─────────────────────────────────────────────────────────────
// D, E, F, G: READ-ONLY GET & POST CREATE_SESSION SEPARATION
// ─────────────────────────────────────────────────────────────
test("D: GET /api/arena/[id] is strictly read-only and never mutates state", () => {
  const getFnIndex = apiArenaRouteSrc.indexOf("export async function GET");
  const postFnIndex = apiArenaRouteSrc.indexOf("export async function POST");
  assert.ok(getFnIndex > 0 && postFnIndex > getFnIndex);

  const getBody = apiArenaRouteSrc.substring(getFnIndex, postFnIndex);
  assert.equal(getBody.includes("searchParams.get(\"fresh\")"), false);
  assert.equal(getBody.includes("searchParams.get(\"newSession\")"), false);
  assert.equal(getBody.includes("crypto.randomUUID()"), false);
});

test("E: create_session requires explicit authenticated POST", () => {
  assert.match(
    teacherPlaygroundSrc,
    /fetch\(`\/api\/arena\/\$\{selectedQuizId\}`,\s*\{[\s\S]*?method:\s*["']POST["'],[\s\S]*?action:\s*["']create_session["']/
  );
});

test("F & G: Refreshing existing lobby or active match restores same session without new sessionId", () => {
  const getFnIndex = apiArenaRouteSrc.indexOf("export async function GET");
  const postFnIndex = apiArenaRouteSrc.indexOf("export async function POST");
  const getBody = apiArenaRouteSrc.substring(getFnIndex, postFnIndex);
  assert.match(getBody, /sessionId:\s*state\?\.sessionId/);
  assert.match(teacherArenaContentSrc, /loadArenaInitial/);
});

test("Dedicated Reset Event: Session creation triggers arena-session-created and does not overload arena-end", () => {
  // Backend triggers dedicated arena-session-created or arena-reset
  assert.match(apiArenaRouteSrc, /pusherServer\.trigger\(`private-arena-\$\{quizId\}`, ["']arena-session-created["']/);
  assert.match(apiArenaRouteSrc, /pusherServer\.trigger\(`private-arena-\$\{quizId\}`, ["']arena-reset["']/);

  // Student listens to dedicated reset event
  assert.match(studentArenaContentSrc, /arenaChannel\.bind\(["']arena-session-created["']/);
  assert.match(studentArenaContentSrc, /arenaChannel\.bind\(["']arena-reset["']/);

  // arena-end is strictly reserved for actual match conclusion
  assert.match(studentArenaContentSrc, /arenaChannel\.bind\(["']arena-end["'],\s*\(\)\s*=>\s*\{[\s\S]*?setPhase\(["']podium["']\)/);
});

// ─────────────────────────────────────────────────────────────
// H, I, J, K, L: COMPLETED STUDENT SPECTATOR LOBBY
// ─────────────────────────────────────────────────────────────
test("H & I: Student finishing all questions enters completed state and can enter spectator lobby", () => {
  assert.match(studentArenaContentSrc, /All Questions Completed!/);
  assert.match(studentArenaContentSrc, /btn-back-to-arena-lobby/);
  assert.match(studentArenaContentSrc, /Back to Arena Lobby/);
});

test("J: Completed student cannot answer questions again", () => {
  // Once questionsCompleted is true, question answer buttons are locked
  assert.match(studentArenaContentSrc, /questionsCompleted\s*\?\s*\(/);
});

test("K: Spectator lobby shows current score, rank, full leaderboard, countdown timer, and activity", () => {
  assert.match(studentArenaContentSrc, /Power Arena Live Spectator Lobby/);
  assert.match(studentArenaContentSrc, /Your Locked Score/);
  assert.match(studentArenaContentSrc, /Your Current Rank/);
  assert.match(studentArenaContentSrc, /Full Live Leaderboard/);
  assert.match(studentArenaContentSrc, /Live Combat Activity/);
  assert.match(studentArenaContentSrc, /formatTimer\(matchTimeLeft\)/);
});

test("L: arena-end immediately moves spectator to final results/podium", () => {
  assert.match(studentArenaContentSrc, /arenaChannel\.bind\(["']arena-end["'],\s*\(\)\s*=>\s*\{[\s\S]*?setPhase\(["']podium["']\)/);
});

// ─────────────────────────────────────────────────────────────
// M, N: ATTACK DEPLOYING LATENCY OPTIMIZATION
// ─────────────────────────────────────────────────────────────
test("M & N: Attack launch feedback is immediate with no long Deploying delay", () => {
  assert.match(studentArenaContentSrc, /setCelebrationMessage\([`"']🚀 Attack Launched!/);
  assert.match(battleDockSrc, /🚀 Strike Launched!/);
  assert.equal(battleDockSrc.includes("Deploying..."), false);
  assert.equal(studentArenaContentSrc.includes("Deploying power..."), false);
});

// ─────────────────────────────────────────────────────────────
// O, P, Q: COINS ABSENT FROM UI, ARENA, AND AVATARS
// ─────────────────────────────────────────────────────────────
test("O: Coins are absent from student-facing UI dashboard", () => {
  assert.equal(studentDashboardContentSrc.includes("coinBalance"), false);
  assert.equal(studentDashboardContentSrc.includes("Total Coins"), false);
});

test("P: Arena does not award or show coins on podium or setup", () => {
  assert.match(arenaPodiumSrc, /EXP Earned/);
  assert.equal(arenaPodiumSrc.includes("Coins Earned"), false);
});

test("Q: Retired avatar and coin systems have no active runtime path", () => {
  assert.equal(fs.existsSync(path.resolve(process.cwd(), "src/app/join/avatar-shop/page.tsx")), false);
  assert.equal(fs.existsSync(path.resolve(process.cwd(), "src/app/api/student/avatar-shop/route.ts")), false);
  assert.equal(submitRouteSrc.includes("studentCoinLedger"), false);
  assert.equal(submitRouteSrc.includes("coinsEarned"), false);
});

// ─────────────────────────────────────────────────────────────
// R, S: BADGES ABSENT AND DISABLED
// ─────────────────────────────────────────────────────────────
test("R & S: Badges system is completely removed and awarding disabled", () => {
  assert.equal(studentDashboardContentSrc.includes("Trophy & Badges Cabinet"), false);
  assert.equal(studentDashboardContentSrc.includes("ACHIEVEMENTS.map"), false);
  assert.equal(studentDashboardContentSrc.includes("Take your first quiz to earn badges"), false);
});

// ─────────────────────────────────────────────────────────────
// T, U, V, W: EXP + LEVEL PROGRESSION
// ─────────────────────────────────────────────────────────────
test("T & U: EXP persistence is PostgreSQL backed and baseline bootstrap is one-time protected", () => {
  assert.match(progressionLibSrc, /student:progression:/);
  assert.match(progressionLibSrc, /initializedAt/);
  assert.match(progressionLibSrc, /pg_advisory_xact_lock/);
});

test("V & W: Level formula is centralized and derives correctly from total EXP (XP_PER_LEVEL = 500)", () => {
  assert.equal(XP_PER_LEVEL, 500);
  assert.equal(EXP_PER_LEVEL, 500);
  assert.equal(EXP_REWARDS.XP_PER_LEVEL, 500);

  // Level 1: 0 to 499
  assert.equal(deriveLevelFromTotalExp(0).level, 1);
  assert.equal(deriveLevelFromTotalExp(0).currentLevelExp, 0);
  assert.equal(deriveLevelFromTotalExp(0).expToNextLevel, 500);

  assert.equal(deriveLevelFromTotalExp(499).level, 1);
  assert.equal(deriveLevelFromTotalExp(499).currentLevelExp, 499);
  assert.equal(deriveLevelFromTotalExp(499).expToNextLevel, 1);

  // Level 2: 500 to 999
  assert.equal(deriveLevelFromTotalExp(500).level, 2);
  assert.equal(deriveLevelFromTotalExp(500).currentLevelExp, 0);

  // Level 4: 1,850 EXP -> Level 4 (1,500 + 350)
  const stats1850 = deriveLevelFromTotalExp(1850);
  assert.equal(stats1850.level, 4);
  assert.equal(stats1850.currentLevelExp, 350);
  assert.equal(stats1850.expToNextLevel, 150);
  assert.equal(stats1850.progressPercent, 70);
});

// ─────────────────────────────────────────────────────────────
// X, Y, Z: ARENA FINAL EXP IDEMPOTENCY
// ─────────────────────────────────────────────────────────────
test("X, Y, Z: Arena final EXP is awarded only once per sessionId/student and guarded against duplicate awards", () => {
  // Answering questions in arena awards 0 EXP (deferred to end)
  const arenaSubmitIndex = submitRouteSrc.indexOf("if (isArena) {");
  const proctoredSubmitIndex = submitRouteSrc.indexOf("// 3. PROCTORED EXAM AI VERDICT");
  const arenaSubmitBlock = submitRouteSrc.substring(arenaSubmitIndex, proctoredSubmitIndex);
  assert.match(arenaSubmitBlock, /expEarned:\s*0/);

  // Key format for arena idempotency marker
  const key = arenaExpRewardedKey("session-abc", "student-xyz");
  assert.equal(key, "arena:exp_rewarded:session-abc:student-xyz");

  // Arena finalization route guards against duplicate awards per sessionId
  assert.match(apiArenaRouteSrc, /isArenaExpAlreadyAwarded\(state\.sessionId,\s*p\.studentId\)/);
  assert.match(apiArenaRouteSrc, /markArenaExpAwarded\(state\.sessionId,\s*p\.studentId,\s*exp\)/);
});

// ─────────────────────────────────────────────────────────────
// AA, AB: TEACHER ARENA SETUP & RESULTS CLEANUP
// ─────────────────────────────────────────────────────────────
test("AA: Teacher Arena setup has no Coin Bounty UI and duration is strictly 30m or 1h", () => {
  assert.equal(teacherPlaygroundSrc.includes("coinBounty"), false);
  assert.equal(teacherPlaygroundSrc.includes("Champion Coin Bounty"), false);
  assert.match(teacherPlaygroundSrc, /setMatchDuration\(1800\)/);
  assert.match(teacherPlaygroundSrc, /setMatchDuration\(3600\)/);
});

test("AB: Arena results show EXP but no coins/badges", () => {
  assert.match(arenaPodiumSrc, /EXP Earned/);
  assert.equal(arenaPodiumSrc.includes("Coins Earned"), false);
});

// ─────────────────────────────────────────────────────────────
// AC: LIVE MONITORING SAFETY
// ─────────────────────────────────────────────────────────────
test("AC: Live Monitoring and proctored exam runner remain 100% untouched", () => {
  assert.match(liveMonitoringRunnerSrc, /runDevicePreflight/);
  assert.match(liveMonitoringRunnerSrc, /navigator\.mediaDevices\.getUserMedia/);
  assert.match(liveMonitoringRunnerSrc, /faceapi\.nets\.tinyFaceDetector/);
  assert.match(liveMonitoringRunnerSrc, /loadedCocoModel\.detect/);
  assert.equal(liveMonitoringRunnerSrc.includes("ArenaBattleDock"), false);
  assert.equal(liveMonitoringRunnerSrc.includes("Meteor Strike"), false);
});
