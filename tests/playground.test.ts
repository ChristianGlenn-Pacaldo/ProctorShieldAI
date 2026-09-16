import assert from "node:assert/strict";
import test from "node:test";
import {
  ARENA_POWER_IDS,
  createArenaState,
  isArenaAction,
  isArenaPowerId,
  normalizeArenaConfig,
} from "../src/lib/arena.ts";
import {
  DEFAULT_STARTER_IDS,
  calculateQuizCoinReward,
  parseStudentAvatarData,
} from "../src/lib/student-coins.ts";

test("arena settings accept only supported modes, durations, bounties, and powers", () => {
  assert.deepEqual(normalizeArenaConfig({
    mode: "wave_sprint",
    waveDuration: "45",
    coinBounty: 1000,
    enabledPowers: ["meteor", "meteor", "shield", "drop-table"],
  }), {
    mode: "wave_sprint",
    waveDuration: 45,
    coinBounty: 1000,
    enabledPowers: ["meteor", "shield"],
  });

  assert.deepEqual(normalizeArenaConfig({
    mode: "admin",
    waveDuration: 999,
    coinBounty: -50,
    enabledPowers: ["unknown"],
  }), {
    mode: "score_arena",
    waveDuration: 30,
    coinBounty: 500,
    enabledPowers: [...ARENA_POWER_IDS],
  });
});

test("arena actions and battle powers are strict allowlists", () => {
  assert.equal(isArenaAction("start"), true);
  assert.equal(isArenaAction("delete"), false);
  assert.equal(isArenaPowerId("blizzard"), true);
  assert.equal(isArenaPowerId("siphon"), false);
});

test("new arena states cannot inherit client-owned identity fields", () => {
  const state = createArenaState({
    quizId: 8,
    teacherId: "teacher-real",
    currentQuestionId: 81,
    config: normalizeArenaConfig({ teacherId: "teacher-forged" }),
  });
  assert.equal(state.quizId, 8);
  assert.equal(state.teacherId, "teacher-real");
  assert.equal(state.currentQuestionId, 81);
  assert.equal(state.status, "lobby");
  assert.ok(state.sessionId.length > 20);
});

test("legacy avatar JSON is bounded and cannot unlock unknown catalog items", () => {
  const parsed = parseStudentAvatarData(JSON.stringify({
    coins: Number.POSITIVE_INFINITY,
    unlockedAvatars: ["dragon", "not-real", 12],
    equippedAvatar: "not-real",
    topOneWins: -9,
  }));
  assert.equal(parsed.coins, 100);
  assert.equal(parsed.topOneWins, 0);
  assert.equal(parsed.equippedAvatar, "shield");
  assert.deepEqual(parsed.unlockedAvatars, [...DEFAULT_STARTER_IDS, "dragon"]);
});

test("invalidated submissions never earn quiz coins", () => {
  assert.deepEqual(calculateQuizCoinReward({
    rank: 1,
    score: 100,
    violationsCount: 3,
    isInvalidated: true,
  }), {
    coins: 0,
    rankTitle: "Invalidated Result",
    isTopOne: false,
    breakdown: ["0 coins awarded due to integrity policy violation"],
  });
});
