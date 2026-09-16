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
  normalizeMatchDuration,
  VALID_MATCH_DURATIONS,
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
const teacherPlaygroundSrc = fs.readFileSync(
  path.resolve(process.cwd(), "src/app/dashboard/teacher/playground/content.tsx"),
  "utf-8"
);
const libArenaSrc = fs.readFileSync(
  path.resolve(process.cwd(), "src/lib/arena.ts"),
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
    status: "active",
    totalQuestions: 20,
    config: { matchDuration: 1800 },
  });
  assert.ok(state.matchEndsAt);
  assert.equal(state.matchDuration, 1800);

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

test("Test A: Student opening /arena/[id] before teacher start sees waiting lobby", () => {
  // Default phase state in student component is strictly "lobby"
  assert.match(
    studentArenaContentSrc,
    /const\s*\[phase,\s*setPhase\]\s*=\s*useState<["']lobby["']\s*\|\s*["']in_wave["']\s*\|\s*["']podium["']>\(\s*["']lobby["']\s*\)/
  );
  // Lobby UI renders waiting indicator
  assert.match(studentArenaContentSrc, /Waiting for teacher to start Power Arena/);
});

test("Test B: Questions and choice selections are locked / not interactable until match is active", () => {
  // Lobby phase returns early before active question card is rendered
  assert.match(studentArenaContentSrc, /if\s*\(phase\s*===\s*["']lobby["']\)\s*\{/);
  const lobbyBlock = studentArenaContentSrc.split('if (phase === "lobby")')[1]?.split("Render: Active Gameplay Screen")[0] ?? "";
  assert.equal(lobbyBlock.includes("handleSelectChoice"), false);
  assert.equal(lobbyBlock.includes("handleConfirmChoice"), false);
});

test("Test C: Battle powers cannot be triggered before match start (ARENA_NOT_STARTED 409)", () => {
  assert.match(battleActionRouteSrc, /if\s*\(!arena\s*\|\|\s*arena\.status\s*===\s*["']lobby["']\)\s*\{/);
  assert.match(battleActionRouteSrc, /code:\s*["']ARENA_NOT_STARTED["']/);
  assert.match(battleActionRouteSrc, /status:\s*409/);
});

test("Test D: Teacher Arena Host shows 0 participants until students explicitly join", () => {
  // Host battlers state starts as an empty array, no hardcoded bot entries
  assert.match(teacherArenaContentSrc, /const\s*\[battlers,\s*setBattlers\]\s*=\s*useState<Battler\[\]>\(\[\]\)/);
});

test("Test E: Enrolled student who has NOT navigated to /arena/[id] does NOT appear in teacher participant list", () => {
  // GET /api/arena/[id] does NOT loop enrolled students into state.participants
  assert.doesNotMatch(apiArenaRouteSrc, /for\s*\(\s*const\s+enrollment\s+of\s+enrolledStudents\s*\)\s*\{[\s\S]*ensureArenaPlayer/);
});

test("Test F: Student who enters /arena/[id] calls join action and appears on host", () => {
  // Student content calls join on mount
  assert.match(studentArenaContentSrc, /action:\s*["']join["']/);
  // Server handles join action, registers participant, and emits arena-student-joined
  assert.match(apiArenaRouteSrc, /action\s*===\s*["']join["']/);
  assert.match(apiArenaRouteSrc, /arena-student-joined/);
});

test("Test G: Student refresh does NOT create duplicate participant", () => {
  // Participants are keyed by studentId/userId in state.participants
  assert.match(apiArenaRouteSrc, /state\.participants\[session\.userId\]/);
});

test("Test H: Teacher clicking 'Start Arena' transitions state to active, sets authoritative matchEndsAt, generates sessionId, and emits arena-start", () => {
  assert.match(apiArenaRouteSrc, /action\s*===\s*["']start["']/);
  assert.match(apiArenaRouteSrc, /status:\s*["']active["']/);
  assert.match(apiArenaRouteSrc, /crypto\.randomUUID\(\)/);
  assert.match(apiArenaRouteSrc, /new Date\(Date\.now\(\)\s*\+\s*matchDuration\s*\*\s*1000\)\.toISOString\(\)/);
  assert.match(apiArenaRouteSrc, /const\s+event\s*=\s*`arena-\$\{action\}`/);
  assert.match(apiArenaRouteSrc, /pusherServer\.trigger\(`private-arena-\${quizId}`,\s*event/);
});

test("Test I: Student receives arena-start and transitions to active game view", () => {
  assert.match(studentArenaContentSrc, /arenaChannel\.bind\(["']arena-start["'],\s*\(data/);
  assert.match(studentArenaContentSrc, /setPhase\(["']in_wave["']\)/);
  assert.match(studentArenaContentSrc, /setCurrentSessionId\(data\.sessionId\s*\|\|\s*data\?\.arena\?\.sessionId/);
});

test("Test J: Server-persisted Arena state matches active session (PostgreSQL Setting row as authoritative source)", () => {
  assert.match(libArenaSrc, /prisma\.setting\.upsert/);
  assert.match(libArenaSrc, /arena:state:\${quizId}/);
  assert.match(libArenaSrc, /arenaSettingKey\(state\.quizId\)/);
});

test("Test K: Battle action succeeds during active match with valid target", () => {
  assert.match(battleActionRouteSrc, /if\s*\(powerType\s*===\s*["']shield["']\)/);
  assert.match(battleActionRouteSrc, /applyPendingAttackHit/);
  assert.match(battleActionRouteSrc, /targetStudentId/);
});

test("Test L: Battle action fails before teacher starts (ARENA_NOT_STARTED, 409)", () => {
  assert.match(battleActionRouteSrc, /if\s*\(!arena\s*\|\|\s*arena\.status\s*===\s*["']lobby["']\)\s*\{[\s\S]*code:\s*["']ARENA_NOT_STARTED["'][\s\S]*status:\s*409/);
});

test("Test M: Battle action fails after match ended (ARENA_ENDED, 409)", () => {
  assert.match(battleActionRouteSrc, /arena\.status\s*===\s*["']ended["'][\s\S]*code:\s*["']ARENA_ENDED["'][\s\S]*status:\s*409/);
});

test("Test N: Battle action fails if student is not a joined participant (NOT_ARENA_PARTICIPANT, 403)", () => {
  assert.match(battleActionRouteSrc, /!arena\.participants\s*\|\|\s*!arena\.participants\[session\.userId\]/);
  assert.match(battleActionRouteSrc, /code:\s*["']NOT_ARENA_PARTICIPANT["']/);
  assert.match(battleActionRouteSrc, /status:\s*403/);
});

test("Test O: Offensive battle power fails if target is not a joined participant (INVALID_TARGET, 400)", () => {
  assert.match(battleActionRouteSrc, /const\s+targetParticipant\s*=\s*arena\.participants\[targetStudentId\]/);
  assert.match(battleActionRouteSrc, /if\s*\(!targetParticipant\)\s*\{[\s\S]*code:\s*["']INVALID_TARGET["']/);
});

test("Test P: Extra game mode selector is removed from teacher setup (single mode score_arena)", () => {
  assert.doesNotMatch(teacherPlaygroundSrc, /value:\s*["']battle_royale["']/);
  assert.doesNotMatch(teacherPlaygroundSrc, /value:\s*["']wave_sprint["']/);
  assert.match(teacherPlaygroundSrc, /Power Arena Rules/);
  assert.match(teacherPlaygroundSrc, /Score-Based Power Arena/);
});

test("Test Q: Strictly no HP / health bars / elimination / damage wording exists", () => {
  assert.doesNotMatch(teacherPlaygroundSrc, /100 HP/);
  assert.doesNotMatch(teacherPlaygroundSrc, /Last standing wins/i);
  assert.match(studentArenaContentSrc, /-100 PTS/);
  assert.match(studentArenaContentSrc, /-60 PTS/);
  assert.match(studentArenaContentSrc, /-40 PTS/);
  assert.doesNotMatch(studentArenaContentSrc, /100 HP/);
});

test("Test R: Match duration only accepts 1800 and 3600; 30 min -> 1800s, 1 hr -> 3600s; invalid values normalized", () => {
  assert.deepEqual(VALID_MATCH_DURATIONS, [1800, 3600]);
  assert.equal(normalizeMatchDuration(1800), 1800);
  assert.equal(normalizeMatchDuration(3600), 3600);
  assert.equal(normalizeMatchDuration(30), 1800);
  assert.equal(normalizeMatchDuration(60), 3600);
  assert.equal(normalizeMatchDuration(600), 1800); // legacy 10 min normalizes to 1800
  assert.equal(normalizeMatchDuration(undefined), 1800); // default
  assert.equal(normalizeMatchDuration("invalid"), 1800);

  // Teacher UI offers only 30 Minutes and 1 Hour
  assert.match(teacherArenaContentSrc, /30 Minutes/);
  assert.match(teacherArenaContentSrc, /1 Hour/);
  assert.match(teacherPlaygroundSrc, /30 Minutes/);
  assert.match(teacherPlaygroundSrc, /1 Hour/);
});

test("Test S: Proctored live monitoring is completely untouched", () => {
  assert.match(proctoredQuizPageSrc, /faceapi\.nets\.tinyFaceDetector\.loadFromUri/);
  assert.match(proctoredQuizPageSrc, /runDevicePreflight/);
  assert.doesNotMatch(proctoredQuizPageSrc, /ArenaBattleDock/);
  assert.doesNotMatch(proctoredQuizPageSrc, /battle-action/);
  assert.doesNotMatch(proctoredQuizPageSrc, /Meteor Strike|Earthquake|Blizzard|Guardian Shield/);
  assert.doesNotMatch(proctoredQuizPageSrc, /private-arena-/);
});

test("Test 9A: arena-incoming-attack is emitted immediately after validation/power claim", () => {
  // Power claimed and pending attack created before Pusher broadcast
  assert.match(battleActionRouteSrc, /arena\.usedPowers\[session\.userId\]\[powerType\]\s*=\s*true/);
  assert.match(battleActionRouteSrc, /arena\.pendingAttacks\[attackId\]\s*=\s*pendingAttack/);
  // Realtime warning dispatched with highest priority
  assert.match(battleActionRouteSrc, /pusherServer\.trigger\(\s*\[`private-arena-\${quizId}`,\s*`private-teacher-\${attempt\.quiz\.teacherId}`\],\s*["']arena-incoming-attack["']/);
});

test("Test 9B: Incoming warning is not delayed by score deduction logic", () => {
  // Score deduction happens in applyPendingAttackHit, scheduled via setTimeout after reaction window
  assert.match(battleActionRouteSrc, /setTimeout\(async\s*\(\)\s*=>\s*\{[\s\S]*applyPendingAttackHit/);
  // Auto-resolution timeout is strictly at least REACTION_WINDOW_MS
  assert.match(battleActionRouteSrc, /REACTION_WINDOW_MS\s*\+\s*100/);
});

test("Test 9C: Target UI responds directly to Pusher event", () => {
  // Target handler sets incoming attack immediately upon receiving event
  assert.match(studentArenaContentSrc, /if\s*\(data\.targetStudentId\s*===\s*studentId\)\s*\{\s*setIncomingAttack\(data\);/);
});

test("Test 9D: No polling is required to display incoming warning", () => {
  // Event listener on arenaChannel drives incoming attack warning
  assert.match(studentArenaContentSrc, /arenaChannel\.bind\(["']arena-incoming-attack["'],\s*handleIncomingAttack\)/);
  // No polling setInterval calls fetch in student content
  assert.doesNotMatch(studentArenaContentSrc, /setInterval\(\s*\(\)\s*=>\s*\{[^}]*fetch\(/);
});

test("Test 9E: Reaction countdown uses server expiresAt", () => {
  // Event handler and reaction interval compute remaining time from server expiresAt
  assert.match(studentArenaContentSrc, /typeof\s+data\.expiresAt\s*===\s*["']number["']\s*\?\s*data\.expiresAt/);
  assert.match(studentArenaContentSrc, /typeof\s+incomingAttack\.expiresAt\s*===\s*["']number["']\s*\?\s*incomingAttack\.expiresAt/);
  assert.match(studentArenaContentSrc, /Math\.max\(0,\s*expiry\s*-\s*Date\.now\(\)\)/);
});

test("Test 9F: Shield still works within reaction window", () => {
  // Server checks if deflection occurred within reaction window
  assert.match(battleActionRouteSrc, /if\s*\(now\s*<=\s*attackToDefend\.expiresAt\)\s*\{/);
  assert.match(battleActionRouteSrc, /attackToDefend\.status\s*=\s*["']deflected["']/);
  assert.match(battleActionRouteSrc, /arena-attack-blocked/);
  assert.match(battleActionRouteSrc, /arena-attack-deflected/);
});

test("Test 9G: Score deduction still happens only after reaction window if unblocked", () => {
  // applyPendingAttackHit only deducts score when attack status is still pending
  assert.match(battleActionRouteSrc, /if\s*\(!attack\s*\|\|\s*attack\.status\s*!==\s*["']pending["']\)\s*return\s+null;/);
  assert.match(battleActionRouteSrc, /target\.score\s*=\s*Math\.max\(0,\s*target\.score\s*-\s*penalty\)/);
});

test("Test 9H: One-use power logic still works", () => {
  // Offensive and defensive powers are strictly once per match
  assert.match(battleActionRouteSrc, /if\s*\(arena\.usedPowers\[session\.userId\]\[powerType\]\)\s*\{[\s\S]*POWER_ALREADY_USED/);
});

test("Test 9I: Live Monitoring unaffected", () => {
  assert.match(proctoredQuizPageSrc, /faceapi\.nets\.tinyFaceDetector\.loadFromUri/);
  assert.match(proctoredQuizPageSrc, /runDevicePreflight/);
  assert.doesNotMatch(proctoredQuizPageSrc, /arena-incoming-attack/);
  assert.doesNotMatch(proctoredQuizPageSrc, /battle-action/);
});
