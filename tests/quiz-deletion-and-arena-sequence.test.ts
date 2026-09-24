import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  createArenaAttackId,
  createArenaState,
  deflectPendingAttackInState,
  ensureArenaParticipant,
  getPowerPenalty,
  resolvePendingAttackInState,
} from "../src/lib/arena.ts";
import {
  DELETED_QUIZ_STATUS,
  isQuizAvailable,
  UNAVAILABLE_QUIZ_STATUSES,
} from "../src/lib/quiz-availability.ts";

function source(relativePath: string) {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), "utf8");
}

const quizzesRoute = source("src/app/api/quizzes/route.ts");
const quizRoute = source("src/app/api/quizzes/[id]/route.ts");
const joinRoute = source("src/app/api/quizzes/join/route.ts");
const sessionRoute = source("src/app/api/quizzes/session/route.ts");
const arenaRoute = source("src/app/api/arena/[id]/route.ts");
const arenaPage = source("src/app/arena/[id]/page.tsx");
const battleRoute = source("src/app/api/arena/battle-action/route.ts");
const arenaContent = source("src/app/arena/[id]/content.tsx");
const resultsRoute = source("src/app/api/dashboard/student/results/route.ts");
const teacherQuizzes = source("src/app/dashboard/teacher/quizzes/content.tsx");

test("deleted, archived, and unavailable quiz states are authoritatively closed", () => {
  assert.equal(isQuizAvailable("draft"), true);
  assert.equal(isQuizAvailable("active"), true);
  assert.equal(isQuizAvailable("in_progress"), true);
  assert.equal(isQuizAvailable("ended"), true);
  for (const status of UNAVAILABLE_QUIZ_STATUSES) assert.equal(isQuizAvailable(status), false);
});

test("teacher deletion is a non-destructive lifecycle transition", () => {
  assert.match(quizRoute, /data:\s*\{\s*quizStatus:\s*DELETED_QUIZ_STATUS,\s*accessCode:\s*null\s*\}/);
  assert.match(quizRoute, /quizStatus:\s*\{\s*notIn:\s*\["completed",\s*"rejected"\]\s*\}/);
  assert.match(quizRoute, /data:\s*\{\s*quizStatus:\s*"rejected",\s*endTime:\s*deletedAt\s*\}/);
  assert.doesNotMatch(quizRoute, /tx\.quiz\.delete\(/);
  assert.doesNotMatch(quizRoute, /tx\.studentQuiz\.deleteMany\(/);
  assert.doesNotMatch(quizRoute, /deleteEvidence\(/);
  assert.match(teacherQuizzes, /Completed results and violation evidence will remain available for historical review/);
  assert.doesNotMatch(teacherQuizzes, /permanently delete all questions/);
});

test("deleted quizzes are excluded from active teacher and student dashboard queries", () => {
  assert.match(quizzesRoute, /quizStatus:\s*\{\s*notIn:\s*\[\.\.\.UNAVAILABLE_QUIZ_STATUSES\]\s*\}/);
  assert.match(quizzesRoute, /quiz:\s*\{\s*quizStatus:\s*\{\s*notIn:\s*\[\.\.\.UNAVAILABLE_QUIZ_STATUSES\]/);
  assert.match(quizzesRoute, /Cache-Control["']:\s*["']private, no-store, max-age=0["']/);
  assert.match(source("src/app/dashboard/student/content.tsx"), /fetch\("\/api\/quizzes",\s*\{\s*cache:\s*"no-store"\s*\}\)/);
  assert.match(source("src/app/dashboard/student/quizzes/content.tsx"), /fetch\("\/api\/quizzes",\s*\{\s*cache:\s*"no-store"\s*\}\)/);
});

test("deleted codes and stale enrollments cannot rejoin", () => {
  assert.match(joinRoute, /findFirst\([\s\S]*accessCode,[\s\S]*UNAVAILABLE_QUIZ_STATUSES/);
  assert.match(joinRoute, /!isQuizAvailable\(currentQuiz\.quizStatus\)/);
  assert.match(joinRoute, /quizNotAvailableResponse\(\)/);
  assert.match(quizRoute, /accessCode:\s*null/);
});

test("deleted proctored quizzes cannot load, preflight, or start", () => {
  assert.match(quizRoute, /if\s*\(!isQuizAvailable\(quiz\.quizStatus\)\)/);
  assert.match(sessionRoute, /!isQuizAvailable\(attempt\.quiz\.quizStatus\)/);
  assert.match(sessionRoute, /!isQuizAvailable\(quiz\.quizStatus\)/);
  assert.match(sessionRoute, /quiz:\s*\{\s*quizStatus:\s*\{\s*notIn:\s*\[\.\.\.UNAVAILABLE_QUIZ_STATUSES\]/);
});

test("deleted Arena quizzes cannot load, join, create participants, or create sessions", () => {
  assert.match(arenaPage, /!isQuizAvailable\(quiz\.quizStatus\)/);
  assert.equal((arenaRoute.match(/quizNotAvailableResponse\(\)/g) || []).length, 2);
  assert.match(arenaRoute, /if\s*\(action\s*===\s*"join"\)/);
  assert.match(arenaRoute, /action\s*===\s*"reset"\s*\|\|\s*action\s*===\s*"create_session"/);
  assert.match(battleRoute, /!isQuizAvailable\(attempt\.quiz\.quizStatus\)/);
});

test("completed historical results remain readable after soft deletion", () => {
  assert.match(resultsRoute, /prisma\.studentQuiz\.findMany/);
  assert.match(resultsRoute, /include:\s*\{[\s\S]*quiz:\s*true/);
  assert.doesNotMatch(resultsRoute, /UNAVAILABLE_QUIZ_STATUSES|isQuizAvailable/);
  assert.equal(DELETED_QUIZ_STATUS, "deleted");
});

test("sequential reversed Arena attacks use independent immutable identities", () => {
  const state = createArenaState({
    quizId: 701,
    teacherId: "teacher",
    status: "active",
    totalQuestions: 3,
    sessionId: "session-701",
  });
  ensureArenaParticipant(state, { studentId: "player-a", studentName: "Player A" }).score = 200;
  ensureArenaParticipant(state, { studentId: "player-b", studentName: "Player B" }).score = 200;

  const firstAttackId = createArenaAttackId(state.sessionId);
  state.pendingAttacks![firstAttackId] = {
    attackId: firstAttackId,
    sessionId: state.sessionId,
    attackerId: "player-a",
    attackerName: "Player A",
    targetStudentId: "player-b",
    targetName: "Player B",
    powerType: "meteor",
    scorePenalty: getPowerPenalty("meteor"),
    createdAt: 1_000,
    expiresAt: 3_500,
    status: "pending",
  };
  assert.equal(deflectPendingAttackInState(state, firstAttackId, {
    now: 3_400,
    defenderStudentId: "player-b",
  }).code, "blocked");
  assert.equal(state.participants["player-b"].score, 200);

  const secondAttackId = createArenaAttackId(state.sessionId);
  assert.notEqual(secondAttackId, firstAttackId);
  state.pendingAttacks![secondAttackId] = {
    attackId: secondAttackId,
    sessionId: state.sessionId,
    attackerId: "player-b",
    attackerName: "Player B",
    targetStudentId: "player-a",
    targetName: "Player A",
    powerType: "meteor",
    scorePenalty: getPowerPenalty("meteor"),
    createdAt: 4_000,
    expiresAt: 6_500,
    status: "pending",
  };
  const secondResolution = resolvePendingAttackInState(state, secondAttackId, { now: 6_501 });
  assert.equal(secondResolution.code, "resolved");
  assert.equal(state.pendingAttacks![firstAttackId].status, "deflected");
  assert.equal(state.pendingAttacks![secondAttackId].status, "hit");
  assert.equal(state.participants["player-a"].score, 100);

  const thirdAttackId = createArenaAttackId(state.sessionId);
  assert.notEqual(thirdAttackId, firstAttackId);
  assert.notEqual(thirdAttackId, secondAttackId);
  state.pendingAttacks![thirdAttackId] = {
    attackId: thirdAttackId,
    sessionId: state.sessionId,
    attackerId: "player-a",
    attackerName: "Player A",
    targetStudentId: "player-b",
    targetName: "Player B",
    powerType: "earthquake",
    scorePenalty: getPowerPenalty("earthquake"),
    createdAt: 7_000,
    expiresAt: 9_500,
    status: "pending",
  };
  assert.equal(resolvePendingAttackInState(state, thirdAttackId, { now: 9_501 }).code, "resolved");
  assert.equal(state.participants["player-b"].score, 140);
  assert.equal(resolvePendingAttackInState(state, thirdAttackId, { now: 10_000 }).code, "already_resolved");
  assert.equal(state.participants["player-b"].score, 140);
});

test("attack realtime payloads and client state are correlated by session and attack", () => {
  assert.match(battleRoute, /createArenaAttackId\(arena\.sessionId\)/);
  assert.match(battleRoute, /sessionId:\s*arena\.sessionId/);
  assert.match(battleRoute, /status:\s*"pending"/);
  assert.match(battleRoute, /status:\s*"hit"/);
  assert.match(battleRoute, /status:\s*"deflected"/);
  assert.match(arenaContent, /data\.sessionId\s*&&\s*currentSessionId\s*&&\s*data\.sessionId\s*!==\s*currentSessionId/);
  assert.match(arenaContent, /incomingAttackRef\.current\?\.attackId\s*===\s*data\.attackId/);
  assert.match(arenaContent, /incomingAttackRef\.current\.attackId\s*!==\s*data\.attackId/);
  assert.match(arenaContent, /setErrorMessage\(null\)/);
  assert.match(arenaContent, /hasNewerIncomingAttack/);
});

test("power values, one-use Shield, and ended review state remain unchanged", () => {
  assert.equal(getPowerPenalty("meteor"), 100);
  assert.equal(getPowerPenalty("earthquake"), 60);
  assert.equal(getPowerPenalty("blizzard"), 40);

  const ended = createArenaState({ quizId: 702, teacherId: "teacher", status: "ended", totalQuestions: 1 });
  ensureArenaParticipant(ended, { studentId: "a", studentName: "A" });
  ensureArenaParticipant(ended, { studentId: "b", studentName: "B" });
  ended.pendingAttacks = {
    ended: {
      attackId: "ended",
      sessionId: ended.sessionId,
      attackerId: "a",
      attackerName: "A",
      targetStudentId: "b",
      targetName: "B",
      powerType: "blizzard",
      scorePenalty: 40,
      createdAt: 1,
      expiresAt: 2,
      status: "pending",
    },
  };
  const snapshot = JSON.stringify(ended);
  assert.equal(deflectPendingAttackInState(ended, "ended", {
    now: 1,
    defenderStudentId: "b",
  }).code, "arena_inactive");
  assert.equal(JSON.stringify(ended), snapshot);
});
