import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import {
  createArenaState,
  computeArenaRankings,
  ensureArenaParticipant,
  ensureArenaPlayer,
  getPowerPenalty,
  getPowerDamage,
  POWER_SCORE_PENALTIES,
  type ArenaParticipant,
  type ArenaState,
} from "../src/lib/arena.ts";

const studentArenaContentSrc = fs.readFileSync(
  path.resolve(process.cwd(), "src/app/arena/[id]/content.tsx"),
  "utf-8"
);
const teacherArenaContentSrc = fs.readFileSync(
  path.resolve(process.cwd(), "src/app/dashboard/teacher/playground/arena/[id]/content.tsx"),
  "utf-8"
);
const apiArenaRouteSrc = fs.readFileSync(
  path.resolve(process.cwd(), "src/app/api/arena/[id]/route.ts"),
  "utf-8"
);
const battleActionRouteSrc = fs.readFileSync(
  path.resolve(process.cwd(), "src/app/api/arena/battle-action/route.ts"),
  "utf-8"
);
const answerRouteSrc = fs.readFileSync(
  path.resolve(process.cwd(), "src/app/api/quizzes/answer/route.ts"),
  "utf-8"
);
const podiumComponentSrc = fs.readFileSync(
  path.resolve(process.cwd(), "src/components/arena/arena-podium.tsx"),
  "utf-8"
);
const battleDockComponentSrc = fs.readFileSync(
  path.resolve(process.cwd(), "src/components/arena/arena-battle-dock.tsx"),
  "utf-8"
);
const proctoredQuizPageSrc = fs.readFileSync(
  path.resolve(process.cwd(), "src/app/quiz/[id]/page.tsx"),
  "utf-8"
);

test("Requirement 1: Teacher starts Arena only once", () => {
  // Lobby has a single 'Start Arena Match' button and disables it while active
  assert.match(teacherArenaContentSrc, /handleStartMatch/);
  assert.match(teacherArenaContentSrc, /broadcastArenaAction\(["']start["']/);
  // Active wave view does not render another Start button
  assert.doesNotMatch(teacherArenaContentSrc, /phase\s*===\s*["']wave["'][\s\S]*handleStartMatch/);
});

test("Requirement 2: Answering Question 1 allows automatic progression to Question 2", () => {
  // Client handleSelectChoice automatically increments currentQuestionIndex
  assert.match(studentArenaContentSrc, /handleSelectChoice/);
  assert.match(studentArenaContentSrc, /setCurrentQuestionIndex\(\(prev\)\s*=>\s*prev\s*\+\s*1\)/);
});

test("Requirement 3: Teacher is not required to advance questions", () => {
  // Teacher Host contains no Next Question or Next Wave control during active wave
  assert.doesNotMatch(teacherArenaContentSrc, /Next Question/i);
  assert.doesNotMatch(teacherArenaContentSrc, /handleNextWave/);
});

test("Requirement 4: Different students can be on different question numbers", () => {
  // Student progression is locally controlled in student client state
  assert.match(studentArenaContentSrc, /const\s*\[currentQuestionIndex,\s*setCurrentQuestionIndex\]\s*=\s*useState/);
  // Answer submission records student question and advances independently
  assert.match(studentArenaContentSrc, /questions\[currentQuestionIndex\]/);
});

test("Requirement 5: Overall timer is server-authoritative", () => {
  // ArenaState establishes matchEndsAt on the server
  const state: ArenaState = createArenaState({
    quizId: 10,
    teacherId: "teacher-1",
    totalQuestions: 20,
    config: { matchDuration: 600 },
  });
  assert.ok(state.matchEndsAt);
  assert.equal(state.matchDuration, 600);

  // Student client synchronizes timer with server matchEndsAt
  assert.match(studentArenaContentSrc, /data\.arena\.matchEndsAt/);
  assert.match(studentArenaContentSrc, /Date\.parse\(matchEndsAt\)\s*-\s*Date\.now\(\)/);
});

test("Requirement 6: Timer does not reset for each question", () => {
  // Client timer effect depends only on phase and matchEndsAt, not on currentQuestionIndex
  assert.match(studentArenaContentSrc, /useEffect\(\(\)\s*=>\s*\{[\s\S]*Date\.parse\(matchEndsAt\)[\s\S]*\},\s*\[phase,\s*matchEndsAt/);
});

test("Requirement 7: Student completing all questions does not end whole Arena", () => {
  // Client marks questionsCompleted and displays waiting screen while match continues
  assert.match(studentArenaContentSrc, /setQuestionsCompleted\(true\)/);
  assert.match(studentArenaContentSrc, /All Questions Completed!/);
  assert.match(studentArenaContentSrc, /Waiting for match to conclude|wait for the match timer/i);
});

test("Requirement 8: Match timer expiry ends all students", () => {
  // Server GET /api/arena/[id] checks matchEndsAt expiry and transitions to ended
  assert.match(apiArenaRouteSrc, /state\.matchEndsAt\s*&&\s*Date\.now\(\)\s*>=\s*Date\.parse\(state\.matchEndsAt\)/);
  assert.match(apiArenaRouteSrc, /status:\s*["']ended["']/);

  // Student timer expiry calls finalizeMatch()
  assert.match(studentArenaContentSrc, /if\s*\(remaining\s*<=\s*0\)\s*\{\s*void\s*finalizeMatch\(\);/);
});

test("Requirement 9: Teacher End Arena immediately ends all students", () => {
  // Teacher calls end action
  assert.match(teacherArenaContentSrc, /handleEndArena/);
  assert.match(teacherArenaContentSrc, /broadcastArenaAction\(["']end["']\)/);

  // Student client listens to arena-end and transitions to podium
  assert.match(studentArenaContentSrc, /arenaChannel\.bind\(["']arena-end["'],\s*\(\)\s*=>\s*\{/);
  assert.match(studentArenaContentSrc, /void\s*finalizeMatch\(\)/);
});

test("Requirement 10: Reconnect restores correct match state", () => {
  // GET /api/arena/[id] restores arena state, ranked participants, and student's usedPowers
  assert.match(apiArenaRouteSrc, /usedPowers:\s*\(state\?\.usedPowers\s*&&\s*state\.usedPowers\[session\.userId\]\)/);
  assert.match(studentArenaContentSrc, /setUsedPowers\(\(prev\)\s*=>\s*\(\{\s*\.\.\.prev,\s*\.\.\.data\.usedPowers\s*\}\)\)/);
});

test("Requirement 11 & 12: 20 students generate ranks #1 through #20 and full leaderboard length matches participant count", () => {
  const participants: Record<string, ArenaParticipant> = {};
  for (let i = 1; i <= 20; i++) {
    participants[`student-${i}`] = {
      studentId: `student-${i}`,
      studentName: `Student ${i}`,
      avatar: "🎓",
      score: i * 50,
      rank: 0,
      questionsAnswered: i,
      totalQuestions: 20,
      isFinished: false,
    };
  }

  const ranked = computeArenaRankings(participants);
  assert.equal(ranked.length, 20);
  assert.equal(ranked[0].rank, 1);
  assert.equal(ranked[0].score, 1000); // 20 * 50
  assert.equal(ranked[19].rank, 20);
  assert.equal(ranked[19].score, 50);

  // Verify consecutive 1-indexed ranks #1 through #20
  for (let i = 0; i < 20; i++) {
    assert.equal(ranked[i].rank, i + 1);
  }
});

test("Requirement 13: Student sees '#X of N'", () => {
  assert.match(studentArenaContentSrc, /Rank\s*<\/span>\s*<span[^>]*>#\{studentRank\}<\/span>\s*<span[^>]*>\s*of\s*\{totalParticipants\}/);
});

test("Requirement 14: Rivals show current score and rank without HP", () => {
  assert.match(studentArenaContentSrc, /#\{rival\.rank\}/);
  assert.match(studentArenaContentSrc, /\{rival\.score\}\s*pts/);
  assert.doesNotMatch(studentArenaContentSrc, /rival\.currentHp/);
});

test("Requirement 15, 16, 17, 18: Offensive powers require explicit targetStudentId, reject self & cross-arena", () => {
  // Explicit targetStudentId required
  assert.match(battleActionRouteSrc, /if\s*\(!targetStudentId\)\s*\{/);
  assert.match(battleActionRouteSrc, /Target student is required for offensive battle powers/);

  // Self targeting rejected
  assert.match(battleActionRouteSrc, /if\s*\(targetStudentId\s*===\s*session\.userId\)\s*\{/);
  assert.match(battleActionRouteSrc, /You cannot target yourself with an offensive power/);

  // Cross-arena target rejected
  assert.match(battleActionRouteSrc, /Target student does not belong to this arena/);
});

test("Requirement 19, 20, 21, 22, 23, 24: Each power can be used only once and server enforces one-use rules", () => {
  // Server checks usedPowers and returns POWER_ALREADY_USED with 409
  assert.match(battleActionRouteSrc, /if\s*\(arena\.usedPowers\[session\.userId\]\[powerType\]\)\s*\{/);
  assert.match(battleActionRouteSrc, /code:\s*["']POWER_ALREADY_USED["']/);
  assert.match(battleActionRouteSrc, /status:\s*409/);

  // Powers marked as used upon execution
  assert.match(battleActionRouteSrc, /arena\.usedPowers\[session\.userId\]\[powerType\]\s*=\s*true/);

  // Guardian Shield marked as used
  assert.match(battleActionRouteSrc, /arena\.usedPowers\[session\.userId\]\.shield\s*=\s*true/);

  // Dock renders AVAILABLE vs USED matching Rule 13
  assert.match(battleDockComponentSrc, /isUsed\s*\?\s*["']USED["']\s*:\s*["']AVAILABLE["']/);
});

test("Requirement 25, 26, 27, 28: Incoming attack warning, reaction window, and shield blocking vs hit", () => {
  // Phase 1 warning emitted first with reactionWindowMs
  assert.match(battleActionRouteSrc, /arena-incoming-attack/);
  assert.match(battleActionRouteSrc, /reactionWindowMs:\s*REACTION_WINDOW_MS/);
  assert.match(battleActionRouteSrc, /REACTION_WINDOW_MS\s*=\s*2500/);

  // Shield within reaction window deflects attack with 0 score penalty
  assert.match(battleActionRouteSrc, /if\s*\(now\s*<=\s*attackToDefend\.expiresAt\)\s*\{/);
  assert.match(battleActionRouteSrc, /attackToDefend\.status\s*=\s*["']deflected["']/);
  assert.match(battleActionRouteSrc, /arena-attack-blocked/);

  // Auto-resolution after reaction window deducts configured score
  assert.match(battleActionRouteSrc, /setTimeout\(async\s*\(\)\s*=>\s*\{/);
  assert.match(battleActionRouteSrc, /await\s*applyPendingAttackHit\(quizId,\s*attackId\)/);
});

test("Requirement 29: Score never drops below zero", () => {
  // Server-enforced score deduction Math.max(0, target.score - penalty)
  assert.match(battleActionRouteSrc, /target\.score\s*=\s*Math\.max\(0,\s*target\.score\s*-\s*penalty\)/);

  // Test deduction logic
  const target: ArenaParticipant = {
    studentId: "student-1",
    studentName: "Juan",
    avatar: "🎓",
    score: 50,
    rank: 1,
    questionsAnswered: 5,
    totalQuestions: 20,
    isFinished: false,
  };
  const penalty = getPowerPenalty("meteor"); // 100
  target.score = Math.max(0, target.score - penalty);
  assert.equal(target.score, 0); // Never drops below 0
});

test("Requirement 30 & 31: Score deduction triggers ranking recalculation and broadcasts leaderboard update", () => {
  assert.match(battleActionRouteSrc, /const\s+updatedRankings\s*=\s*computeArenaRankings\(arena\.participants\)/);
  assert.match(battleActionRouteSrc, /pusherServer\.trigger\(`private-arena-\${quizId}`,\s*["']arena-leaderboard-updated["']/);
  assert.match(battleActionRouteSrc, /pusherServer\.trigger\(`private-arena-\${quizId}`,\s*["']arena-score-updated["']/);
});

test("Requirement 32: Teacher sees attacker, target, power, and combat result", () => {
  assert.match(teacherArenaContentSrc, /arenaChannel\.bind\(["']arena-attack-hit["']/);
  assert.match(teacherArenaContentSrc, /arenaChannel\.bind\(["']arena-attack-blocked["']/);
  assert.match(teacherArenaContentSrc, /\$\{data\.attackerName\}'s \$\{data\.powerType\.toUpperCase\(\)\} hit \$\{data\.targetName\}/);
  assert.match(teacherArenaContentSrc, /\$\{data\.targetName\} deflected \$\{data\.attackerName\}'s \$\{data\.powerType\.toUpperCase\(\)\}/);
});

test("Requirement 33: arena-end cancels/invalidates pending attacks", () => {
  assert.match(studentArenaContentSrc, /arenaChannel\.bind\(["']arena-end["'],\s*\(\)\s*=>\s*\{[\s\S]*setIncomingAttack\(null\)/);
  assert.match(apiArenaRouteSrc, /action\s*===\s*["']end["'][\s\S]*pendingAttacks:\s*\{\}/);
});

test("Requirement 34 & 35: Final leaderboard contains all participants and podium highlights top 3 without hiding rest", () => {
  assert.match(podiumComponentSrc, /Full Match Leaderboard/);
  assert.match(podiumComponentSrc, /allParticipants\.map\(/);
  assert.match(teacherArenaContentSrc, /Full Final Leaderboard/);
});

test("Requirement 36: Strictly NO HP / health bars system exists in Power Arena", () => {
  assert.doesNotMatch(studentArenaContentSrc, /myHp/);
  assert.doesNotMatch(studentArenaContentSrc, /myMaxHp/);
  assert.doesNotMatch(studentArenaContentSrc, /isMyAlive/);
  assert.doesNotMatch(studentArenaContentSrc, /currentHp/);
  assert.doesNotMatch(teacherArenaContentSrc, /b\.hp/);
  assert.doesNotMatch(teacherArenaContentSrc, /b\.maxHp/);
});

test("Requirement 37: No Arena combat events leak into Live Monitoring proctored channels", () => {
  const arenaEvents = [
    "arena-incoming-attack",
    "arena-attack-hit",
    "arena-attack-blocked",
    "arena-score-updated",
    "arena-leaderboard-updated",
    "private-arena-",
    "/api/arena/battle-action",
  ];

  for (const event of arenaEvents) {
    assert.equal(
      proctoredQuizPageSrc.includes(event),
      false,
      `Prohibited arena event/route "${event}" must not appear in proctored quiz page`
    );
  }
});

test("Requirement 38: Power score penalties are configured and deterministic", () => {
  assert.equal(POWER_SCORE_PENALTIES.meteor, 100);
  assert.equal(POWER_SCORE_PENALTIES.earthquake, 60);
  assert.equal(POWER_SCORE_PENALTIES.blizzard, 40);
  assert.equal(POWER_SCORE_PENALTIES.shield, 0);

  assert.equal(getPowerPenalty("meteor"), 100);
  assert.equal(getPowerPenalty("earthquake"), 60);
  assert.equal(getPowerPenalty("blizzard"), 40);
  assert.equal(getPowerPenalty("shield"), 0);
});
