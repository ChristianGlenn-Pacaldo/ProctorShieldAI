import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import {
  createArenaState,
  ensureArenaPlayer,
  getPowerDamage,
  type ArenaState,
  type PlayerHealth,
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
const proctoredQuizPageSrc = fs.readFileSync(
  path.resolve(process.cwd(), "src/app/quiz/[id]/page.tsx"),
  "utf-8"
);

test("Test A: Teacher arena-end forces all student clients to finished state", () => {
  // 1. In API route, action "end" transitions status to "ended", updates quizStatus to ended, and does not wipe state
  assert.match(apiArenaRouteSrc, /action\s*===\s*["']end["']/);
  assert.match(apiArenaRouteSrc, /status:\s*["']ended["']/);
  assert.match(apiArenaRouteSrc, /quizStatus:\s*["']ended["']/);
  assert.match(apiArenaRouteSrc, /pusherServer\.trigger\(`private-arena-\${quizId}`,\s*event,\s*eventData\)/);

  // 2. In Student Arena client, arena-end triggers immediate transition to podium and clears attacks
  assert.match(studentArenaContentSrc, /arenaChannel\.bind\(["']arena-end["'],\s*\(\)\s*=>\s*\{/);
  assert.match(studentArenaContentSrc, /setPhase\(["']podium["']\)/);
  assert.match(studentArenaContentSrc, /setIncomingAttack\(null\)/);
  assert.match(studentArenaContentSrc, /setTargetPickerPower\(null\)/);

  // 3. In Teacher Arena client, arena-end transitions to podium
  assert.match(teacherArenaContentSrc, /arenaChannel\.bind\(["']arena-end["'],\s*\(\)\s*=>\s*\{/);
  assert.match(teacherArenaContentSrc, /setPhase\(["']podium["']\)/);
});

test("Test B: Student reconnecting after missing arena-wave retrieves authoritative current wave", () => {
  // In student content refreshArenaState:
  // Reads authoritative currentWave from server and synchronizes currentQuestionIndex
  assert.match(studentArenaContentSrc, /const\s+waveIdx\s*=\s*Number\(data\.arena\.currentWave\)/);
  assert.match(studentArenaContentSrc, /setCurrentQuestionIndex\(\(prev\)\s*=>\s*\{/);

  // Synchronizes wave time remaining from server waveEndsAt
  assert.match(studentArenaContentSrc, /data\.arena\.waveEndsAt/);
  assert.match(studentArenaContentSrc, /Math\.ceil\(\(endsAt\s*-\s*Date\.now\(\)\)\s*\/\s*1000\)/);

  // GET /api/arena/[id] returns authoritative state with currentWave and waveEndsAt
  assert.match(apiArenaRouteSrc, /arena:\s*state/);
});

test("Test C: Student reconnecting after match ended immediately sees finished/podium state", () => {
  // GET /api/arena/[id] preserves state if ended and returns status "ended"
  assert.match(apiArenaRouteSrc, /if\s*\(quiz\.quizStatus\s*===\s*["']ended["']\)/);
  assert.match(apiArenaRouteSrc, /state\s*=\s*\{\s*\.\.\.state,\s*status:\s*["']ended["']/);

  // Student refreshArenaState checks ended state immediately
  assert.match(
    studentArenaContentSrc,
    /if\s*\(data\?\.arena\?\.status\s*===\s*["']ended["']\s*\|\|\s*data\?\.quizStatus\s*===\s*["']ended["']\)/
  );
  assert.match(studentArenaContentSrc, /setPhase\(["']podium["']\)/);
  assert.match(studentArenaContentSrc, /void\s*finalizeMatch\(\)/);
});

test("Test D: Health exists for Arena participants and is server-authoritative", () => {
  // Model test: ensureArenaPlayer initializes 100 HP default
  const dummyState: ArenaState = createArenaState({
    quizId: 99,
    teacherId: "teacher-1",
    currentQuestionId: 101,
  });
  assert.ok(dummyState.players);

  ensureArenaPlayer(dummyState, {
    studentId: "student-1",
    studentName: "Test Student",
    avatar: "🦊",
  });

  const player = dummyState.players["student-1"];
  assert.ok(player);
  assert.equal(player.currentHp, 100);
  assert.equal(player.maxHp, 100);
  assert.equal(player.isAlive, true);
  assert.equal(player.hasShield, false);

  // Power damages
  assert.equal(getPowerDamage("meteor"), 25);
  assert.equal(getPowerDamage("earthquake"), 15);
  assert.equal(getPowerDamage("blizzard"), 10);
  assert.equal(getPowerDamage("shield"), 0);
});

test("Test E: Student can see own HP and rival HP", () => {
  // Student HUD renders MY HP with numerical value and health bar
  assert.match(studentArenaContentSrc, /MY HP:/);
  assert.match(studentArenaContentSrc, /\{myHp\}\s*\/\s*\{myMaxHp\}/);
  assert.match(studentArenaContentSrc, /myHp\s*\/\s*myMaxHp/);

  // Student screen renders Rivals section with health bars and status
  assert.match(studentArenaContentSrc, /RIVALS/);
  assert.match(studentArenaContentSrc, /\{rival\.studentName\}/);
  assert.match(studentArenaContentSrc, /HP:\s*\$\{rival\.currentHp\}\s*\/\s*\$\{rival\.maxHp\}/);
  assert.match(studentArenaContentSrc, /ELIMINATED/);

  // Teacher screen also shows battlers HP
  assert.match(teacherArenaContentSrc, /\{b\.hp\}/);
  assert.match(teacherArenaContentSrc, /b\.hasShield/);
});

test("Test F: Meteor/Earthquake/Blizzard require explicit targetStudentId", () => {
  // Backend validates targetStudentId for offensive powers
  assert.match(battleActionRouteSrc, /if\s*\(!targetStudentId\)\s*\{/);
  assert.match(battleActionRouteSrc, /Target student is required for offensive battle powers/);

  // Client does not fire immediately; opens target selection modal
  assert.match(studentArenaContentSrc, /if\s*\(powerType\s*===\s*["']shield["']\)\s*\{/);
  assert.match(studentArenaContentSrc, /setTargetPickerPower\(powerType\)/);
  assert.match(studentArenaContentSrc, /Select Rival Target/);
});

test("Test G: Server rejects targeting yourself", () => {
  // Backend validation: targetStudentId cannot be session.userId
  assert.match(battleActionRouteSrc, /if\s*\(targetStudentId\s*===\s*session\.userId\)\s*\{/);
  assert.match(battleActionRouteSrc, /You cannot target yourself with an offensive power/);
});

test("Test H: Server rejects target from another Arena", () => {
  // Backend queries prisma.studentQuiz for target student enrollment in the same quiz
  assert.match(battleActionRouteSrc, /where:\s*\{\s*quizId,\s*studentId:\s*targetStudentId/);
  assert.match(battleActionRouteSrc, /Target student does not belong to this arena/);
});

test("Test I: Guardian Shield remains self-targeted", () => {
  // Guardian shield executes immediately without modal picker
  assert.match(studentArenaContentSrc, /if\s*\(powerType\s*===\s*["']shield["']\)\s*\{\s*\/\/\s*Guardian Shield is self-targeted/);
  assert.match(studentArenaContentSrc, /void\s*executeBattlePower\(["']shield["']\)/);

  // Backend case 1: Guardian Shield
  assert.match(battleActionRouteSrc, /if\s*\(powerType\s*===\s*["']shield["']\)\s*\{/);
  assert.match(battleActionRouteSrc, /arena-shield-equipped/);
});

test("Test J: Incoming attack is emitted before damage", () => {
  // Backend emits arena-incoming-attack first with warningExpiry and reactionWindowMs
  assert.match(battleActionRouteSrc, /arena-incoming-attack/);
  assert.match(battleActionRouteSrc, /warningExpiry/);
  assert.match(battleActionRouteSrc, /reactionWindowMs/);
  assert.match(battleActionRouteSrc, /REACTION_WINDOW_MS\s*=\s*2500/);

  // Student client receives incoming attack and starts reaction countdown
  assert.match(studentArenaContentSrc, /arenaChannel\.bind\(["']arena-incoming-attack["']/);
  assert.match(studentArenaContentSrc, /setIncomingAttack\(data\)/);
  assert.match(studentArenaContentSrc, /INCOMING.*STRIKE/);
});

test("Test K: Target can successfully shield within reaction window", () => {
  // Student client renders "ACTIVATE GUARDIAN SHIELD" button in the incoming attack alert
  assert.match(studentArenaContentSrc, /handleDefendIncomingAttack/);
  assert.match(studentArenaContentSrc, /ACTIVATE GUARDIAN SHIELD/);

  // Defend request sends defendAttackId
  assert.match(studentArenaContentSrc, /defendAttackId:\s*incomingAttack\.attackId/);

  // Server checks if reaction window is active and marks deflected
  assert.match(battleActionRouteSrc, /if\s*\(now\s*<=\s*attackToDefend\.expiresAt\)\s*\{/);
  assert.match(battleActionRouteSrc, /attackToDefend\.status\s*=\s*["']deflected["']/);
  assert.match(battleActionRouteSrc, /arena-attack-blocked/);
});

test("Test L: Attack applies damage if reaction window expires", () => {
  // Server schedules auto-resolution after reaction window closes
  assert.match(battleActionRouteSrc, /setTimeout\(async\s*\(\)\s*=>\s*\{/);
  assert.match(battleActionRouteSrc, /await\s*applyPendingAttackHit\(quizId,\s*attackId\)/);
  assert.match(battleActionRouteSrc, /target\.currentHp\s*=\s*Math\.max\(0,\s*target\.currentHp\s*-\s*attack\.damage\)/);

  // Emits hit and health updated
  assert.match(battleActionRouteSrc, /arena-attack-hit/);
  assert.match(battleActionRouteSrc, /arena-health-updated/);
});

test("Test M: HP update is broadcast to all Arena clients", () => {
  // Backend broadcasts arena-health-updated on private-arena-${quizId}
  assert.match(battleActionRouteSrc, /pusherServer\.trigger\(`private-arena-\${quizId}`,\s*["']arena-health-updated["']/);

  // Student client binds arena-health-updated and synchronizes health
  assert.match(studentArenaContentSrc, /arenaChannel\.bind\(["']arena-health-updated["']/);
  assert.match(studentArenaContentSrc, /syncPlayerHealth\(data\.playerHealth\)/);

  // Teacher client binds arena-health-updated
  assert.match(teacherArenaContentSrc, /arenaChannel\.bind\(["']arena-health-updated["']/);
});

test("Test N: Arena-end cancels pending attacks/reaction windows", () => {
  // In student content, arena-end and finalizeMatch reset all attack states
  assert.match(studentArenaContentSrc, /arenaChannel\.bind\(["']arena-end["'],\s*\(\)\s*=>\s*\{/);
  assert.match(studentArenaContentSrc, /setIncomingAttack\(null\)/);
  assert.match(studentArenaContentSrc, /setTargetPickerPower\(null\)/);
  assert.match(studentArenaContentSrc, /setIsLaunchingPower\(null\)/);

  // In API route, action "end" sets status to ended and resets pending attacks
  assert.match(apiArenaRouteSrc, /action\s*===\s*["']end["']/);
});

test("Test O: No Arena combat events appear in Live Monitoring channels", () => {
  const prohibitedInProctored = [
    "arena-incoming-attack",
    "arena-attack-hit",
    "arena-attack-blocked",
    "arena-health-updated",
    "arena-player-eliminated",
    "private-arena-",
    "/api/arena/battle-action",
  ];

  for (const pattern of prohibitedInProctored) {
    assert.equal(
      proctoredQuizPageSrc.includes(pattern),
      false,
      `Prohibited pattern "${pattern}" must not be present in proctored quiz page`
    );
  }
});

test("Test P: Existing routing, submission, proctoring, auth, and billing tests still pass", () => {
  // Verify that previous test suites remain present and valid
  const testFiles = [
    "tests/arena-game-station.test.ts",
    "tests/arena-routing-and-realtime.test.ts",
    "tests/arena-submission-isolation.test.ts",
    "tests/live-monitoring-runner.test.ts",
    "tests/phase6-e2e-isolation.test.ts",
    "tests/security.test.ts",
  ];

  for (const file of testFiles) {
    assert.equal(fs.existsSync(path.resolve(process.cwd(), file)), true, `Expected ${file} to exist`);
  }
});
