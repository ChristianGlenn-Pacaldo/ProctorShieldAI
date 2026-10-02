import assert from "node:assert/strict";
import test from "node:test";
import { arenaFixture } from "./helpers/arena-fixture.ts";

function expire(f: ReturnType<typeof arenaFixture>) {
  const state = f.read(); state.matchEndsAt = new Date(Date.now() - 1000).toISOString(); f.save(state);
}

test("the original single scored participant expiry persists 100 points and its full once-only award", async () => {
  const f = arenaFixture(); await f.answer("a");
  const state = f.read(); delete state.participants.b; delete state.participants.c; f.save(state);
  expire(f);
  const response = await f.submit("a");
  assert.equal(response.status, 200);
  assert.equal(response.body.result.score, 100);
  assert.equal(response.body.result.expEarned, 200);
  assert.equal(f.data.attempts.get("a").score, 100);
  assert.equal(f.data.attempts.get("a").quizStatus, "completed");
  assert.equal(JSON.parse(f.data.settings.get("student:progression:a").settingValue).totalExp, 200);
  assert.equal(f.read().participants.a.questionsAnswered, 1);
  assert.equal(f.data.attempts.get("b").score, 0);
  assert.ok(!f.data.settings.has("arena:exp_rewarded:session-1:b"));
});

test("natural expiry durably finalizes scores, progress, rankings and exactly-once EXP", async () => {
  const f = arenaFixture();
  await f.answer("a"); await f.answer("b"); await f.answer("b", 2);
  expire(f);
  const result = await f.get();
  assert.equal(result.status, 200);
  assert.equal(result.body.quizStatus, "ended");
  assert.deepEqual(result.body.participants.map((p: any) => [p.studentId, p.score, p.questionsAnswered]), [["b", 200, 2], ["a", 100, 1], ["c", 0, 0]]);
  for (const [id, score, exp] of [["a", 100, 160], ["b", 200, 200], ["c", 0, 140]] as const) {
    const attempt = f.data.attempts.get(id);
    assert.equal(attempt.quizStatus, "completed"); assert.equal(attempt.score, score); assert.ok(attempt.endTime);
    assert.equal(JSON.parse(f.data.settings.get(`student:progression:${id}`).settingValue).totalExp, exp);
    assert.equal((await f.submit(id)).body.result.expEarned, exp);
  }
  const snapshot = JSON.stringify([...f.data.settings]);
  await f.overlap(() => f.get(), () => f.action("end"), () => f.submit("a"));
  assert.equal(JSON.stringify([...f.data.settings]), snapshot);
  assert.equal(f.events.filter((event) => event.event === "arena-end").length, 1);
  assert.equal(f.data.notifications.length, 6);
  assert.ok((await f.restartRead()).finalizedAt);
});

for (const failure of ["progression", "marker", "attempt", "notification", "quiz", "state", "commit"]) {
  test(`expiry ${failure} failure rolls back every write and result/cache delivery; retry recovers`, async () => {
    const f = arenaFixture(); await f.answer("a"); expire(f);
    const before = JSON.stringify([...f.data.settings]);
    const events = f.events.length; f.timeline.splice(0); f.fail(failure);
    assert.equal((await f.get()).status, 500);
    assert.equal(JSON.stringify([...f.data.settings]), before);
    assert.equal(f.data.attempts.get("a").quizStatus, "in_progress");
    assert.equal(f.data.notifications.length, 0);
    assert.equal(f.events.length, events); assert.ok(!f.timeline.includes("cache"));
    assert.equal((await f.get()).status, 200);
    assert.equal(f.data.attempts.get("a").score, 100);
  });
}

test("restart recovers the legacy ended/null-score expiry without phantom bootstrap EXP", async () => {
  const f = arenaFixture(); await f.answer("a");
  const state = f.read(); state.status = "ended"; f.save(state);
  f.data.quiz.quizStatus = "ended";
  for (const attempt of f.data.attempts.values()) {
    attempt.quizStatus = "completed"; attempt.score = null; attempt.endTime = new Date();
  }
  assert.equal((await f.submit("a")).body.result.score, 100);
  assert.equal(JSON.parse(f.data.settings.get("student:progression:a").settingValue).totalExp, 200);
  assert.equal((await f.submit("a")).body.result.expEarned, 200);
});

test("expiry recovery through answer, autosave, battle and submission rejects late actions", async () => {
  for (const action of ["answer", "autosave", "attack", "submit"] as const) {
    const f = arenaFixture(); await f.answer("a"); expire(f);
    const result = await f[action]("a");
    assert.equal(result.status, action === "submit" ? 200 : 409, action);
    assert.equal(f.data.attempts.get("a").score, 100, action);
    assert.ok(f.read().finalizedAt, action);
  }
});

test("Redis or realtime failure leaves final results durable and replayable", async () => {
  const f = arenaFixture(); await f.answer("a"); expire(f);
  f.redisFailure(); f.pusherFailure();
  assert.equal((await f.get()).status, 200);
  assert.equal((await f.submit("a")).body.result.score, 100);
  assert.equal((await f.restartRead()).participants.a.score, 100);
});
