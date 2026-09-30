import assert from "node:assert/strict";
import test from "node:test";
import { arenaFixture } from "./helpers/arena-fixture.ts";
import { acceptArenaRevision, guardArenaChannel, hasTerminalArenaFeedback } from "../src/lib/arena-feedback.ts";

test("two concurrent distinct attacks commit both attacks and power claims", async () => {
  const f = arenaFixture();
  const results = await Promise.all([f.attack("a"), f.attack("b", "earthquake")]);
  assert.deepEqual(results.map((r) => r.status), [200, 200]);
  assert.equal(Object.keys(f.read().pendingAttacks).length, 2);
  assert.equal(f.read().usedPowers.a.meteor, true);
  assert.equal(f.read().usedPowers.b.earthquake, true);
  assert.equal(f.read().revision, 2);
});

test("two simultaneous joins survive including initial lobby creation", async () => {
  const f = arenaFixture("lobby");
  f.data.settings.delete("arena:state:77");
  const results = await Promise.all([f.action("join", "a"), f.action("join", "b")]);
  assert.deepEqual(results.map((r) => r.status), [200, 200]);
  assert.deepEqual(Object.keys(f.read().participants).sort(), ["a", "b"]);
  assert.equal(f.read().revision, 2);
});

test("simultaneous answers preserve different students and different questions", async () => {
  const f = arenaFixture();
  const results = await Promise.all([f.answer("a", 1), f.answer("a", 2), f.answer("b", 1)]);
  assert.deepEqual(results.map((r) => r.status), [200, 200, 200]);
  assert.equal(f.read().participants.a.score, 200);
  assert.equal(f.read().participants.a.questionsAnswered, 2);
  assert.equal(f.read().participants.a.isFinished, true);
  assert.equal(f.read().participants.b.score, 100);
  assert.equal(f.data.answers.size, 3);
});

test("duplicate answers count once and replay returns the committed score", async () => {
  const f = arenaFixture();
  const results = await Promise.all([f.answer("a"), f.answer("a")]);
  assert.equal(results.filter((r) => r.body.alreadyAnswered).length, 1);
  assert.equal(f.read().participants.a.score, 100);
  assert.equal(f.read().participants.a.questionsAnswered, 1);
  assert.equal(f.data.answers.size, 1);
  assert.equal((await f.answer("a")).body.score, 100);
  assert.equal(f.events.filter((e) => e.event === "arena-answer").length, 1);
});

test("concurrent use of the same power succeeds once", async () => {
  const f = arenaFixture();
  const results = await Promise.all([f.attack("a"), f.attack("a")]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  assert.equal(Object.keys(f.read().pendingAttacks).length, 1);
});

test("pre-armed Shield and attack creation preserve both valid mutations in either order", async () => {
  for (const shieldFirst of [true, false]) {
    const f = arenaFixture();
    const shield = () => f.attack("c", "shield");
    const attack = () => f.attack("a");
    const results = await Promise.all(shieldFirst ? [shield(), attack()] : [attack(), shield()]);
    assert.deepEqual(results.map((r) => r.status), [200, 200]);
    assert.equal(f.read().participants.c.hasShield, true);
    assert.equal(f.read().usedPowers.c.shield, true);
    assert.equal(Object.keys(f.read().pendingAttacks).length, 1);
  }
});

test("attack creation versus resolution keeps both attacks and applies one hit", async () => {
  const f = arenaFixture();
  const first = await f.attack("a");
  const state = f.read(); state.pendingAttacks[first.body.attackId].expiresAt = Date.now() - 1;
  state.participants.c.score = 200; f.save(state);
  const results = await Promise.all([
    f.attack("b", "earthquake"),
    f.attack("c", "meteor", { action: "resolve-attack", attackId: first.body.attackId }),
  ]);
  assert.deepEqual(results.map((r) => r.status), [200, 200]);
  assert.equal(Object.keys(f.read().pendingAttacks).length, 2);
  assert.equal(f.read().pendingAttacks[first.body.attackId].status, "hit");
  assert.equal(f.read().participants.c.score, 100);
  await f.attack("c", "meteor", { action: "resolve-attack", attackId: first.body.attackId });
  assert.equal(f.read().participants.c.score, 100);
});

test("expiry versus attack and answer cannot revive an expired session", async () => {
  const f = arenaFixture();
  const state = f.read(); state.matchEndsAt = new Date(Date.now() - 1).toISOString(); f.save(state);
  const results = await Promise.all([f.get(), f.attack("a"), f.answer("b")]);
  assert.equal(results[0].status, 200);
  assert.equal(results[1].status, 409); assert.equal(results[2].status, 409);
  assert.equal(f.read().status, "ended");
  assert.equal(f.data.quiz.quizStatus, "ended");
  assert.equal(f.data.answers.size, 0);
  assert.equal(Object.keys(f.read().pendingAttacks).length, 0);
});

test("answer and power versus Teacher End remain consistent in either lock order", async () => {
  for (const endFirst of [true, false]) {
    const f = arenaFixture();
    const work = [() => f.answer("a"), () => f.attack("b")];
    const jobs = endFirst ? [() => f.action("end"), ...work] : [...work, () => f.action("end")];
    const results = await f.overlap(jobs[0], ...jobs.slice(1));
    assert.equal(results[endFirst ? 0 : 2].status, 200);
    assert.equal(f.read().status, "ended");
    assert.equal(f.data.quiz.quizStatus, "ended");
    assert.equal(f.data.attempts.get("a").quizStatus, "completed");
    assert.equal(f.data.attempts.get("a").score, endFirst ? 0 : 100);
    assert.equal(f.data.answers.size, endFirst ? 0 : 1);
    assert.equal(Object.keys(f.read().pendingAttacks).length, 0);
  }
});

test("reset versus mutation cannot restore a previous session in either order", async () => {
  for (const resetFirst of [true, false]) {
    const f = arenaFixture();
    const jobs = resetFirst ? [() => f.action("reset"), () => f.attack("a")] : [() => f.attack("a"), () => f.action("reset")];
    const results = await f.overlap(jobs[0], ...jobs.slice(1));
    assert.equal(results[resetFirst ? 0 : 1].status, 200);
    assert.notEqual(f.read().sessionId, "session-1");
    assert.equal(f.read().status, "lobby");
    assert.equal(Object.keys(f.read().participants).length, 0);
    assert.equal(Object.keys(f.read().pendingAttacks).length, 0);
    assert.equal((await f.answer("a")).status, 409);
  }
});

test("state persistence and commit failures roll back answers and emit no success or cache work", async () => {
  for (const failure of ["state", "commit"]) {
    const f = arenaFixture(); const before = f.read(); f.fail(failure);
    assert.equal((await f.answer("a")).status, 500);
    assert.deepEqual(f.read(), before);
    assert.equal(f.data.answers.size, 0);
    assert.equal(f.events.length, 0);
    assert.equal(f.timeline.includes("cache"), false);
    assert.equal((await f.answer("a")).status, 200);
    assert.equal(f.read().participants.a.score, 100);
  }
});

test("Shield persistence rollback emits no equipped event or used-power marker", async () => {
  const f = arenaFixture(); f.fail("state");
  assert.equal((await f.attack("a", "shield")).status, 500);
  assert.equal(f.read().participants.a.hasShield, false);
  assert.equal(f.read().usedPowers.a, undefined);
  assert.equal(f.events.length, 0);
});

test("Redis and Pusher failures preserve committed PostgreSQL mutations and safe replay", async () => {
  const f = arenaFixture(); f.redisFailure(); f.pusherFailure();
  const results = await Promise.all([f.attack("a"), f.attack("b", "earthquake"), f.answer("c")]);
  assert.deepEqual(results.map((r) => r.status), [200, 200, 200]);
  assert.equal(Object.keys(f.read().pendingAttacks).length, 2);
  assert.equal(f.read().participants.c.score, 100);
  const readback = await f.restartRead();
  assert.equal(Object.keys(readback.pendingAttacks).length, 2);
  assert.equal(readback.participants.c.questionsAnswered, 1);
});

test("database read failure cannot fall back to cache or authorize a power", async () => {
  const f = arenaFixture(); const before = f.read(); f.fail("read");
  assert.equal((await f.attack("a")).status, 500);
  assert.deepEqual(f.read(), before); assert.equal(f.events.length, 0);
});

test("teacher replay identities make airdrop and reset idempotent", async () => {
  const f = arenaFixture();
  const results = await Promise.all([f.action("airdrop", "teacher", { actionId: "same-drop" }), f.action("airdrop", "teacher", { actionId: "same-drop" })]);
  assert.deepEqual(results.map((r) => r.status), [200, 200]);
  assert.equal(f.read().participants.a.score, 50);
  assert.equal(f.events.filter((e) => e.event === "arena-airdrop").length, 1);
  await f.action("reset", "teacher", { actionId: "same-reset" });
  const id = f.read().sessionId;
  await f.action("reset", "teacher", { actionId: "same-reset" });
  assert.equal(f.read().sessionId, id);
});

test("repeated start preserves progress and authorization survives the refactor", async () => {
  const f = arenaFixture(); await f.answer("a");
  assert.equal((await f.action("start")).status, 200);
  assert.equal(f.read().participants.a.score, 100);
  assert.equal((await f.action("end", "a")).status, 403);
  assert.equal((await f.action("end", "teacher", { sessionId: "old-session" })).status, 409);
});

test("End failure rolls back scores, EXP, completion and ended state together", async () => {
  for (const failure of ["state", "marker", "quiz", "attempt"]) {
    const f = arenaFixture(); await f.answer("a"); f.events.length = 0;
    const before = f.read(); f.fail(failure);
    assert.equal((await f.action("end")).status, 500);
    assert.deepEqual(f.read(), before);
    assert.equal(f.data.quiz.quizStatus, "in_progress");
    assert.equal(f.data.attempts.get("a").quizStatus, "in_progress");
    assert.equal([...f.data.settings.keys()].some((key) => key.startsWith("arena:exp_rewarded:")), false);
    assert.equal(f.events.length, 0);
  }
});

test("deflecting one attack while another is created preserves both terminal and pending state", async () => {
  const f = arenaFixture();
  const first = await f.attack("a");
  const results = await Promise.all([
    f.attack("c", "shield", { defendAttackId: first.body.attackId }),
    f.attack("b", "earthquake"),
  ]);
  assert.deepEqual(results.map((r) => r.status), [200, 200]);
  assert.equal(f.read().pendingAttacks[first.body.attackId].status, "deflected");
  assert.equal(Object.values(f.read().pendingAttacks).filter((a: any) => a.status === "pending").length, 1);
  assert.equal(f.read().usedPowers.c.shield, true);
  assert.equal(f.read().usedPowers.b.earthquake, true);
});

test("post-commit responses and events carry the persisted revision", async () => {
  const f = arenaFixture();
  const result = await f.action("airdrop");
  assert.equal(result.body.arena.revision, f.read().revision);
  assert.equal(f.events[0].data.arenaRevision, f.read().revision);
  assert.ok(f.timeline.indexOf("commit") < f.timeline.indexOf("cache"));
  assert.ok(f.timeline.indexOf("commit") < f.timeline.findIndex((item) => item.startsWith("event:")));
});

test("delayed realtime and readback snapshots cannot replace a newer revision", () => {
  const cursor = { current: 0 };
  const callbacks = new Map<string, (data: unknown) => void>();
  const channel = { bind: (event: string, handler: (data: unknown) => void) => callbacks.set(event, handler), unbind_all: () => callbacks.clear() };
  const guarded = guardArenaChannel(channel, cursor);
  const seen: number[] = [];
  guarded.bind("score", (data: any) => seen.push(data.arenaRevision));
  callbacks.get("score")!({ arenaRevision: 2 });
  callbacks.get("score")!({ arenaRevision: 1 });
  callbacks.get("score")!({ arenaRevision: 2 });
  assert.deepEqual(seen, [2, 2]);
  assert.equal(acceptArenaRevision(cursor, { arena: { revision: 1 } }), false);
  assert.equal(acceptArenaRevision(cursor, { arena: { revision: 3 } }), true);
  guarded.unbind_all(); assert.equal(callbacks.size, 0);
});

test("teacher replay receipts cannot bypass role checks or change parameters", async () => {
  const f = arenaFixture();
  await f.action("airdrop", "teacher", { actionId: "receipt" });
  assert.equal((await f.action("airdrop", "a", { actionId: "receipt" })).status, 403);
  assert.equal((await f.action("airdrop", "teacher", { actionId: "receipt", payload: { different: true } })).status, 409);
  await f.action("airdrop", "teacher", { actionId: "__proto__" });
  await f.action("airdrop", "teacher", { actionId: "__proto__" });
  assert.equal(f.read().participants.a.score, 100);
});

test("Arena submission regrades fresh locked answers after waiting for answer commit", async () => {
  const f = arenaFixture();
  const results = await f.overlap(() => f.answer("a"), () => f.submit("a"));
  assert.deepEqual(results.map((r) => r.status), [200, 200]);
  assert.equal(f.data.answers.size, 1);
  assert.equal([...f.data.answers.values()][0].isCorrect, true);
  assert.equal(f.data.attempts.get("a").score, 50);
  assert.equal(f.read().participants.a.score, 100);
  assert.equal((await f.answer("a", 2)).status, 409);
});

test("autosave cannot replace a scored Arena answer or write after Teacher End", async () => {
  const f = arenaFixture();
  const results = await f.overlap(() => f.answer("a"), () => f.autosave("a"));
  assert.deepEqual(results.map((r) => r.status), [200, 200]);
  assert.equal([...f.data.answers.values()][0].isCorrect, true);
  assert.equal(f.read().participants.a.questionsAnswered, 1);
  await f.action("end");
  assert.equal((await f.autosave("a")).status, 409);
});

test("a delayed attack warning survives unrelated newer scores and cannot reopen terminal feedback", () => {
  const cursor = { current: 9 };
  let callback!: (data: unknown) => void;
  const channel = { bind: (_event: string, handler: (data: unknown) => void) => { callback = handler; } };
  const seen: string[] = [];
  const displayed = new Set<string>();
  guardArenaChannel(channel, cursor).bind("arena-incoming-attack", (data: any) => {
    if (!hasTerminalArenaFeedback(displayed, data.attackId)) seen.push(data.attackId);
  });
  callback({ arenaRevision: 8, attackId: "still-pending" });
  displayed.add("terminal:hit");
  callback({ arenaRevision: 8, attackId: "terminal" });
  assert.deepEqual(seen, ["still-pending"]);
  assert.equal(cursor.current, 9);
});


test("quiz metadata edit waiting behind Teacher End cannot restore pre-End status", async () => {
  const f = arenaFixture();
  const results = await f.overlap(() => f.action("end"), () => f.editQuiz());
  assert.equal(results[0].status, 200);
  assert.ok([200, 409].includes(results[1].status));
  assert.equal(f.data.quiz.quizStatus, "ended");
  assert.equal(f.read().status, "ended");
});

test("quiz delete versus Arena action cannot restore a deleted quiz", async () => {
  for (const deleteFirst of [true, false]) {
    const f = arenaFixture();
    const jobs = deleteFirst ? [() => f.deleteQuiz(), () => f.action("airdrop")] : [() => f.action("airdrop"), () => f.deleteQuiz()];
    const results = await f.overlap(jobs[0], jobs[1]);
    assert.equal(results[0].status, 200);
    assert.equal(f.data.quiz.quizStatus, "deleted");
    assert.equal((await f.answer("a")).status, 409);
    assert.equal((await f.action("start")).status, 410);
  }
});

test("legacy start versus reset uses the Arena lock and preserves the reset session", async () => {
  const f = arenaFixture("lobby");
  const results = await f.overlap(() => f.action("reset"), () => f.legacyStart());
  assert.deepEqual(results.map((r) => r.status), [200, 200]);
  assert.equal(f.read().status, "lobby");
  assert.notEqual(f.read().sessionId, "session-1");
  assert.deepEqual(f.read().participants, {});
});
