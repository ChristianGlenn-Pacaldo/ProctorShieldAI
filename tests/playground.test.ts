import assert from "node:assert/strict";
import test from "node:test";
import {
  ARENA_POWER_IDS,
  createArenaState,
  isArenaAction,
  isArenaPowerId,
  normalizeArenaConfig,
} from "../src/lib/arena.ts";

test("arena settings accept only supported modes, durations, and powers", () => {
  assert.deepEqual(normalizeArenaConfig({
    mode: "wave_sprint",
    waveDuration: "45",
    enabledPowers: ["meteor", "meteor", "shield", "drop-table"],
  }), {
    mode: "wave_sprint",
    waveDuration: 45,
    enabledPowers: ["meteor", "shield"],
  });

  assert.deepEqual(normalizeArenaConfig({
    mode: "admin",
    waveDuration: 999,
    enabledPowers: ["unknown"],
  }), {
    mode: "score_arena",
    waveDuration: 30,
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
