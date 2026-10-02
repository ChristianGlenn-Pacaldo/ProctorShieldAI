import assert from "node:assert/strict";
import test from "node:test";
import { arenaFixture } from "./helpers/arena-fixture.ts";

function pending(f: ReturnType<typeof arenaFixture>, due: number) {
  const state = f.read(); state.participants.a.score = 500; state.participants.b.score = 450;
  state.pendingAttacks = { lost: { attackId: "lost", sessionId: state.sessionId, attackerId: "b", attackerName: "B",
    targetStudentId: "a", targetName: "A", powerType: "meteor", scorePenalty: 100,
    createdAt: due - 2500, expiresAt: due, status: "pending" } };
  f.save(state);
}

test("original lost callback: read-only polling does nothing; finalization settles hit before ranking and EXP", async () => {
  const f = arenaFixture(); pending(f, Date.now() - 1000);
  const params = { params: Promise.resolve({ id: "77" }) };
  for (let n = 0; n < 3; n++) await f.load("arena/[id]", "a").GET({ nextUrl: { searchParams: new URLSearchParams({ view: "snapshot" }) } }, params);
  assert.equal(f.read().participants.a.score, 500); assert.equal(f.read().pendingAttacks.lost.status, "pending");
  const state = f.read(); state.matchEndsAt = new Date(Date.now() - 100).toISOString(); f.save(state);
  assert.equal((await f.submit("a")).status, 200);
  assert.equal(f.data.attempts.get("a").score, 400); assert.equal(f.read().attackResults.lost.status, "hit");
  assert.equal(f.read().participants.b.rank, 1);
  assert.equal(JSON.parse(f.data.settings.get("student:progression:a").settingValue).totalExp, 160);
  assert.equal(JSON.parse(f.data.settings.get("student:progression:b").settingValue).totalExp, 200);
  assert.equal(f.events.filter((event) => event.event === "arena-attack-hit").length, 1);
  await f.action("end"); await f.submit("a"); assert.equal(f.data.attempts.get("a").score, 400);
});

for (const failure of ["state", "commit", "marker", "notification"]) test(`combat plus finalization ${failure} failure rolls everything back`, async () => {
  const f = arenaFixture(); pending(f, Date.now() - 1000);
  const state = f.read(); state.matchEndsAt = new Date(Date.now() - 100).toISOString(); f.save(state);
  const before = JSON.stringify([...f.data.settings]); f.fail(failure);
  assert.equal((await f.submit("a")).status, 500); assert.equal(JSON.stringify([...f.data.settings]), before);
  assert.equal(f.events.length, 0); assert.equal(f.read().pendingAttacks.lost.status, "pending");
  assert.equal((await f.submit("a")).status, 200); assert.equal(f.data.attempts.get("a").score, 400);
});

test("deflected outcome survives recovery; merely available shield never auto-deflects", async () => {
  const f = arenaFixture(); pending(f, Date.now() - 1000);
  const state = f.read(); state.participants.a.hasShield = true; f.save(state);
  await f.arena.mutateArena(77, (m: any) => f.finalization.recoverArenaAttacks(m), f.db);
  assert.equal(f.read().participants.a.score, 400); assert.ok(!f.read().usedPowers.a?.shield);
  const g = arenaFixture(); pending(g, Date.now() + 1000);
  assert.equal((await g.attack("a", "shield", { defendAttackId: "lost" })).body.deflected, true);
  await g.action("end"); assert.equal(g.read().attackResults.lost.status, "deflected"); assert.equal(g.data.attempts.get("a").score, 500);
});

test("historical valid completed score and reward remain unchanged despite abandoned pending attack", async () => {
  const f = arenaFixture(); pending(f, Date.now() - 1000);
  for (const attempt of f.data.attempts.values()) { attempt.quizStatus = "completed"; attempt.score = attempt.studentId === "a" ? 500 : 450; attempt.endTime = new Date(); }
  f.data.quiz.quizStatus = "ended";
  const state = f.read(); state.status = "ended"; state.endedAt = new Date().toISOString(); f.save(state);
  await f.submit("a"); assert.equal(f.data.attempts.get("a").score, 500); assert.equal(f.read().attackResults.lost.status, "cancelled");
  assert.equal(f.events.filter((event) => event.event === "arena-attack-hit").length, 0);
});

test("invalid old-session attack cannot mutate score or block a valid attack", async () => {
  const f = arenaFixture(); pending(f, Date.now() - 1000);
  const state = f.read(); state.pendingAttacks.old = { ...state.pendingAttacks.lost, attackId: "old", sessionId: "previous", expiresAt: Date.now() - 2000 }; f.save(state);
  await f.arena.mutateArena(77, (m: any) => f.finalization.recoverArenaAttacks(m), f.db);
  assert.equal(f.read().participants.a.score, 400); assert.equal(f.read().pendingAttacks.old.status, "cancelled");
  assert.equal(f.read().pendingAttacks.lost.status, "hit");
});

test("legacy incomplete completion uses persisted manual cutoff, not later recovery time", async () => {
  for (const dueBeforeEnd of [true, false]) {
    const f = arenaFixture(); const endedAt = Date.now() - 5000;
    pending(f, endedAt + (dueBeforeEnd ? -10 : 10));
    const state = f.read(); state.status = "ended"; state.endedAt = new Date(endedAt).toISOString();
    state.completionReason = "teacher_end"; f.save(state); f.data.quiz.quizStatus = "ended";
    for (const attempt of f.data.attempts.values()) { attempt.quizStatus = "completed"; attempt.score = null; attempt.endTime = new Date(endedAt); }
    assert.equal((await f.submit("a")).status, 200);
    assert.equal(f.data.attempts.get("a").score, dueBeforeEnd ? 400 : 500);
    assert.equal(f.read().attackResults.lost.status, dueBeforeEnd ? "hit" : "cancelled");
    assert.equal(f.data.attempts.get("a").endTime.getTime(), endedAt);
    assert.equal(f.read().completionReason, "teacher_end");
  }
});
