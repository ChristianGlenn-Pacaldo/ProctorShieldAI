import assert from "node:assert/strict";
import test from "node:test";
import {
  createArenaState,
  ensureArenaParticipant,
  reconcileExpiredArenaAttacks,
  type ArenaState,
} from "../src/lib/arena.ts";
import {
  awardArenaExpOnce,
  arenaExpRewardedKey,
} from "../src/lib/student-progression.ts";

function transactionalStore(initial: Record<string, string> = {}) {
  let settings = new Map(Object.entries(initial).map(([settingKey, settingValue]) => [
    settingKey,
    { settingKey, settingValue },
  ]));
  let tail = Promise.resolve();
  let failMarkerCreate = false;

  const setting = {
    findUnique: async ({ where }: any) => settings.get(where.settingKey) || null,
    upsert: async ({ where, update, create }: any) => {
      const current = settings.get(where.settingKey);
      const record = current ? { ...current, ...update } : { ...create };
      settings.set(where.settingKey, record);
      return record;
    },
    create: async ({ data }: any) => {
      if (failMarkerCreate && data.settingKey.startsWith("arena:exp_rewarded:")) {
        throw new Error("marker write failed");
      }
      if (settings.has(data.settingKey)) throw new Error("unique setting key");
      settings.set(data.settingKey, { ...data });
      return data;
    },
  };
  const tx: any = {
    setting,
    studentQuiz: { findMany: async () => [] },
    $executeRaw: async () => 1,
  };
  const client: any = {
    ...tx,
    $transaction: async (operation: (transaction: any) => Promise<any>) => {
      const previous = tail;
      let release!: () => void;
      tail = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      const before = structuredClone(settings);
      try {
        return await operation(tx);
      } catch (error) {
        settings = before;
        throw error;
      } finally {
        release();
      }
    },
  };

  return {
    client,
    get: (key: string) => settings.get(key),
    setFailMarkerCreate: (value: boolean) => { failMarkerCreate = value; },
  };
}

function expiredAttackState(): ArenaState {
  const state = createArenaState({ quizId: 77, teacherId: "teacher", status: "active", totalQuestions: 3 });
  ensureArenaParticipant(state, { studentId: "attacker", studentName: "Attack Student" }).score = 200;
  ensureArenaParticipant(state, { studentId: "target", studentName: "Target Student" }).score = 120;
  state.pendingAttacks = {
    durable: {
      attackId: "durable", attackerId: "attacker", attackerName: "Attack Student",
      targetStudentId: "target", targetName: "Target Student", powerType: "earthquake",
      scorePenalty: 60, createdAt: 1_000, expiresAt: 2_000, status: "pending",
    },
  };
  return state;
}

test("expired persisted attack is recovered on the next read and resolves exactly once", async () => {
  const state = expiredAttackState();
  const store = transactionalStore({ "arena:state:77": JSON.stringify(state) });

  const [first, concurrent] = await Promise.all([
    reconcileExpiredArenaAttacks(77, 3_000, store.client),
    reconcileExpiredArenaAttacks(77, 3_000, store.client),
  ]);
  assert.equal(first.resolved.length + concurrent.resolved.length, 1);

  const persisted = JSON.parse(store.get("arena:state:77")!.settingValue) as ArenaState;
  assert.equal(persisted.pendingAttacks?.durable.status, "hit");
  assert.equal(persisted.participants.target.score, 60);

  const afterRestart = await reconcileExpiredArenaAttacks(77, 5_000, store.client);
  assert.equal(afterRestart.resolved.length, 0);
  assert.equal(afterRestart.state?.participants.target.score, 60);
});

test("simultaneous Arena finalization awards EXP once and reload remains idempotent", async () => {
  const store = transactionalStore();
  const finalize = () => awardArenaExpOnce("session-1", "student-1", 100, "Arena Match Completion", store.client);
  const results = await Promise.all([finalize(), finalize()]);
  assert.equal(results.filter((result) => result.awarded).length, 1);

  const progression = JSON.parse(store.get("student:progression:student-1")!.settingValue);
  assert.equal(progression.totalExp, 100);
  assert.ok(store.get(arenaExpRewardedKey("session-1", "student-1")));
  assert.equal((await finalize()).awarded, false);
  assert.equal(JSON.parse(store.get("student:progression:student-1")!.settingValue).totalExp, 100);
});

test("failed Arena EXP transaction leaves no marker or partial reward and retry succeeds once", async () => {
  const store = transactionalStore();
  const markerKey = arenaExpRewardedKey("session-2", "student-2");
  store.setFailMarkerCreate(true);
  await assert.rejects(
    awardArenaExpOnce("session-2", "student-2", 160, "Arena Match Completion", store.client),
    /marker write failed/,
  );
  assert.equal(store.get(markerKey), undefined);
  assert.equal(store.get("student:progression:student-2"), undefined);

  store.setFailMarkerCreate(false);
  const retry = await awardArenaExpOnce("session-2", "student-2", 160, "Arena Match Completion", store.client);
  assert.equal(retry.awarded, true);
  assert.equal(JSON.parse(store.get("student:progression:student-2")!.settingValue).totalExp, 160);
  assert.ok(store.get(markerKey));
});
