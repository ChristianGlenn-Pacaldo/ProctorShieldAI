import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  createArenaState,
  deflectArenaAttack,
  deflectPendingAttackInState,
  ensureArenaParticipant,
  resolveArenaAttack,
  resolvePendingAttackInState,
  type ArenaState,
} from "../src/lib/arena.ts";
import { claimArenaFeedback, getShieldTerminalOutcome } from "../src/lib/arena-feedback.ts";

function transactionalStore(state: ArenaState) {
  const settings = new Map([
    [`arena:state:${state.quizId}`, { settingKey: `arena:state:${state.quizId}`, settingValue: JSON.stringify(state) }],
  ]);
  let tail = Promise.resolve();

  const setting = {
    findUnique: async ({ where }: any) => settings.get(where.settingKey) || null,
    upsert: async ({ where, update, create }: any) => {
      const current = settings.get(where.settingKey);
      const record = current ? { ...current, ...update } : { ...create };
      settings.set(where.settingKey, record);
      return record;
    },
  };
  const tx: any = { setting, $executeRaw: async () => 1 };
  const client: any = {
    ...tx,
    $transaction: async (operation: (transaction: any) => Promise<any>) => {
      const previous = tail;
      let release!: () => void;
      tail = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      try {
        return await operation(tx);
      } finally {
        release();
      }
    },
  };

  return {
    client,
    read: () => JSON.parse(settings.get(`arena:state:${state.quizId}`)!.settingValue) as ArenaState,
  };
}

function pendingAttackState(quizId = 501, powerType: "meteor" | "earthquake" | "blizzard" = "earthquake") {
  const state = createArenaState({ quizId, teacherId: "teacher", status: "active", totalQuestions: 3 });
  ensureArenaParticipant(state, { studentId: "attacker", studentName: "Attack Student" }).score = 200;
  ensureArenaParticipant(state, { studentId: "defender", studentName: "Defend Student" }).score = 75;
  state.usedPowers.attacker = { [powerType]: true };
  state.pendingAttacks = {
    attack: {
      attackId: "attack",
      attackerId: "attacker",
      attackerName: "Attack Student",
      targetStudentId: "defender",
      targetName: "Defend Student",
      powerType,
      scorePenalty: powerType === "meteor" ? 100 : powerType === "earthquake" ? 60 : 40,
      createdAt: 1_000,
      expiresAt: 2_000,
      status: "pending",
    },
  };
  return state;
}

test("Shield received at the server before expiry blocks with zero score deduction", () => {
  const state = pendingAttackState();
  const result = deflectPendingAttackInState(state, "attack", {
    now: 1_999,
    defenderStudentId: "defender",
  });

  assert.equal(result.code, "blocked");
  assert.equal(state.pendingAttacks?.attack.status, "deflected");
  assert.equal(state.participants.defender.score, 75);
  assert.equal(state.usedPowers.defender.shield, true);
  assert.deepEqual(state.usedPowers.attacker, { earthquake: true });
});

test("Shield is marked used only after a successful activation", () => {
  const alreadyUsed = pendingAttackState();
  alreadyUsed.usedPowers.defender = { shield: true };
  const rejected = deflectPendingAttackInState(alreadyUsed, "attack", {
    now: 1_900,
    defenderStudentId: "defender",
  });
  assert.equal(rejected.code, "shield_already_used");
  assert.equal(alreadyUsed.pendingAttacks?.attack.status, "pending");

  const inactive = pendingAttackState();
  inactive.status = "ended";
  const before = JSON.stringify(inactive);
  assert.equal(deflectPendingAttackInState(inactive, "attack", {
    now: 1_900,
    defenderStudentId: "defender",
  }).code, "arena_inactive");
  assert.equal(JSON.stringify(inactive), before);
});

test("Late Shield resolves one hit, preserves score floor, and does not consume Shield", () => {
  const state = pendingAttackState(502, "meteor");
  const result = deflectPendingAttackInState(state, "attack", {
    now: 2_001,
    defenderStudentId: "defender",
  });

  assert.equal(result.code, "too_late");
  assert.equal(result.resolvedHit, true);
  assert.equal(state.pendingAttacks?.attack.status, "hit");
  assert.equal(state.participants.defender.score, 0);
  assert.equal(state.usedPowers.defender?.shield, undefined);

  const snapshot = JSON.stringify(state);
  assert.equal(deflectPendingAttackInState(state, "attack", {
    now: 2_100,
    defenderStudentId: "defender",
  }).code, "already_resolved");
  assert.equal(JSON.stringify(state), snapshot);
});

test("Duplicate Shield and duplicate resolver calls never mutate a terminal attack", () => {
  const shielded = pendingAttackState(503);
  assert.equal(deflectPendingAttackInState(shielded, "attack", {
    now: 1_900,
    defenderStudentId: "defender",
  }).code, "blocked");
  const shieldedSnapshot = JSON.stringify(shielded);
  assert.equal(deflectPendingAttackInState(shielded, "attack", {
    now: 1_950,
    defenderStudentId: "defender",
  }).code, "already_resolved");
  assert.equal(resolvePendingAttackInState(shielded, "attack", { now: 2_100 }).code, "already_resolved");
  assert.equal(JSON.stringify(shielded), shieldedSnapshot);

  const hit = pendingAttackState(504);
  assert.equal(resolvePendingAttackInState(hit, "attack", { now: 2_001 }).code, "resolved");
  const hitSnapshot = JSON.stringify(hit);
  assert.equal(resolvePendingAttackInState(hit, "attack", { now: 2_100 }).code, "already_resolved");
  assert.equal(JSON.stringify(hit), hitSnapshot);
});

test("Concurrent Shield and resolver requests serialize to exactly one outcome", async () => {
  const shieldFirstStore = transactionalStore(pendingAttackState(505));
  const [shieldFirst, resolverSecond] = await Promise.all([
    deflectArenaAttack(505, "attack", { now: 1_999, defenderStudentId: "defender" }, shieldFirstStore.client),
    resolveArenaAttack(505, "attack", { now: 2_001 }, shieldFirstStore.client),
  ]);
  assert.equal(shieldFirst.resolution.code, "blocked");
  assert.equal(resolverSecond.resolution.code, "already_resolved");
  assert.equal(shieldFirstStore.read().pendingAttacks?.attack.status, "deflected");
  assert.equal(shieldFirstStore.read().participants.defender.score, 75);

  const resolverFirstStore = transactionalStore(pendingAttackState(506));
  const [resolverFirst, shieldSecond] = await Promise.all([
    resolveArenaAttack(506, "attack", { now: 2_001 }, resolverFirstStore.client),
    deflectArenaAttack(506, "attack", { now: 1_999, defenderStudentId: "defender" }, resolverFirstStore.client),
  ]);
  assert.equal(resolverFirst.resolution.code, "resolved");
  assert.equal(shieldSecond.resolution.code, "already_resolved");
  assert.equal(resolverFirstStore.read().pendingAttacks?.attack.status, "hit");
  assert.equal(resolverFirstStore.read().participants.defender.score, 15);
});

test("Reaction boundary uses server time and gives Shield the expiry instant", () => {
  const state = pendingAttackState(507);
  assert.equal(resolvePendingAttackInState(state, "attack", { now: 2_000 }).code, "premature");
  assert.equal(deflectPendingAttackInState(state, "attack", {
    now: 2_000,
    defenderStudentId: "defender",
  }).code, "blocked");
});

test("Arena modal uses authoritative terminal state and an activation guard", () => {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), "src/app/arena/[id]/content.tsx"),
    "utf8",
  );
  assert.match(source, /authoritativeAttack\.status\s*!==\s*"pending"/);
  assert.match(source, /clearIncomingAttack\(data\.attackId\)/);
  assert.match(source, /setIsShieldActivating\(true\)/);
  assert.match(source, /ACTIVATING SHIELD\.\.\./);
  assert.match(source, /reactionTimeLeftMs\s*<=\s*0/);
  assert.match(source, /setTimeout\([\s\S]*10_000/);
});

test("Shield feedback appears once across both realtime aliases and the API response", () => {
  for (const order of [
    ["arena-attack-blocked", "attack-blocked", "response"],
    ["response", "arena-attack-blocked", "attack-blocked"],
  ]) {
    const displayed = new Set<string>();
    const results = order.map(() => claimArenaFeedback(displayed, "attack-one", "deflected"));
    assert.deepEqual(results, [true, false, false]);
  }
});

test("later Arena attacks and terminal outcomes retain independent feedback", () => {
  const displayed = new Set<string>();
  assert.equal(claimArenaFeedback(displayed, "attack-one", "launched"), true);
  assert.equal(claimArenaFeedback(displayed, "attack-one", "launched"), false);
  assert.equal(claimArenaFeedback(displayed, "attack-one", "deflected"), true);
  assert.equal(claimArenaFeedback(displayed, "attack-two", "hit"), true);
  assert.equal(claimArenaFeedback(displayed, "attack-two", "hit"), false);
  assert.equal(claimArenaFeedback(displayed, "attack-three", "hit"), true);
});

test("Shield response distinguishes a confirmed block from a late hit", () => {
  assert.equal(getShieldTerminalOutcome({ code: "blocked", attackStatus: "deflected" }), "deflected");
  assert.equal(getShieldTerminalOutcome({ code: "already_resolved", attackStatus: "deflected" }), "deflected");
  assert.equal(getShieldTerminalOutcome({ code: "already_resolved", attackStatus: "hit" }), "hit");
  assert.equal(getShieldTerminalOutcome({ code: "too_late", attackStatus: "hit" }), "hit");
  assert.equal(getShieldTerminalOutcome({ code: "shield_already_used", attackStatus: "pending" }), null);
});

test("Arena client gates duplicate events and response feedback and uses one Shield icon", () => {
  const source = fs.readFileSync(path.resolve(process.cwd(), "src/app/arena/[id]/content.tsx"), "utf8");
  assert.match(source, /arenaChannel\.bind\("arena-attack-blocked", handleAttackBlockedEvent\)/);
  assert.match(source, /arenaChannel\.bind\("attack-blocked", handleAttackBlockedEvent\)/);
  assert.match(source, /showAttackFeedback\(data\.attackId, "deflected"/);
  assert.match(source, /showAttackFeedback\(attackToDefend\.attackId, "deflected"/);
  assert.match(source, /claimAttackFeedback\(data\.attackId, "launched"\)/);
  assert.doesNotMatch(source, /message:\s*`🛡️/);
  assert.match(source, /authoritativeAttack\?\.status === "deflected"/);
  assert.match(source, /authoritativeAttack\?\.status === "hit"/);
  assert.match(source, /getShieldTerminalOutcome\(data\)/);
  assert.doesNotMatch(source, /rounded-3xl p-4 sm:p-5[^\n]*animate-bounce/);
});

test("teacher Arena feed shows one launch and one terminal result per attack across both channels", () => {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), "src/app/dashboard/teacher/playground/arena/[id]/content.tsx"),
    "utf8",
  );
  for (const event of ["arena-incoming-attack", "arena-attack-hit", "arena-attack-blocked"]) {
    assert.match(source, new RegExp(`arenaChannel\\.bind\\("${event}"`));
    assert.match(source, new RegExp(`teacherChannel\\.bind\\("${event}"`));
  }
  for (const outcome of ["launched", "hit", "deflected"]) {
    assert.match(source, new RegExp(`claimArenaFeedback\\(displayedCombatFeedbackRef\\.current, data\\.attackId, "${outcome}"\\)`));
  }
});
