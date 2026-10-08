import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { arenaFixture as serverFixture } from "./helpers/arena-fixture.ts";
import { acceptArenaRevision } from "../src/lib/arena-feedback.ts";

const arenaSource = fs.readFileSync(path.resolve(process.cwd(), "src/app/arena/[id]/content.tsx"), "utf8");
const arenaFile = ts.createSourceFile("content.tsx", arenaSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function finalizationCallback() {
  let callback: string | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "finalizeMatch"
      && node.initializer && ts.isCallExpression(node.initializer)) {
      callback = node.initializer.arguments[0]?.getText(arenaFile);
    }
    ts.forEachChild(node, visit);
  };
  visit(arenaFile);
  assert.ok(callback);
  const output = ts.transpileModule(`exports.finalizeMatch = ${callback};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return output;
}

type SubmitResponse = { ok: boolean; body: Record<string, unknown> } | "network-error" | "invalid-json";

function arenaFixture(responses: SubmitResponse[]) {
  const state = { phase: "in_wave", error: null as string | null, finalizing: false,
    submits: 0, rankings: 0, score: null as number | null, rank: null as number | null };
  const refs = {
    finalizationAttemptedRef: { current: false },
    finalizationInFlightRef: { current: false },
    finalizationConfirmedRef: { current: false },
    finalizationGenerationRef: { current: 0 },
    arenaCompletedRef: { current: false },
    reconciliationRef: { current: { async refresh() { state.rankings++; state.phase = "podium"; } } },
    arenaRevisionRef: { current: 0 },
  };
  const exports: { finalizeMatch?: (retry?: boolean) => Promise<void> } = {};
  vm.runInNewContext(finalizationCallback(), {
    exports,
    Error,
    acceptArenaRevision,
    ...refs,
    quizId: 46,
    currentSessionId: undefined,
    lockedAnswers: new Map([[101, { choiceId: 205, isCorrect: true }]]),
    fetch: async (url: string, options?: { body: string }) => {
      if (url.startsWith("/api/arena/")) return { ok: true, json: async () => ({ participants: [] }) };
      assert.equal(url, "/api/quizzes/submit");
      assert.deepEqual(JSON.parse(options!.body), { quizId: 46, answers: { 101: 205 } });
      state.submits++;
      const response = responses.shift();
      assert.ok(response);
      if (response === "network-error") throw new Error("connection lost");
      if (response === "invalid-json") return { ok: false, json: async () => { throw new SyntaxError("Invalid JSON"); } };
      return { ok: response.ok, json: async () => response.body };
    },
    setIncomingAttack() {}, setTargetPickerPower() {}, setIsLaunchingPower() {},
    setIsFinalizing(value: boolean) { state.finalizing = value; },
    setFinalizationError(value: string | null) { state.error = value; },
    setPhase(value: string) { state.phase = value; },
    setStudentRank(value: number) { state.rank = value; },
    setScore(value: number) { state.score = value; },
    setArenaCompleted() {},
    updateRankingsFromParticipants() { state.rankings++; },
  });
  assert.ok(exports.finalizeMatch);
  assert.match(arenaSource, /if \(phase === "finalizing"\)[\s\S]*?role="alert"[\s\S]*?Retry Submission/);
  assert.match(arenaSource, /ARENA_QUIZ_ALREADY_COMPLETED[\s\S]*?reconciliationRef\.current\?\.refresh\(\)/);
  return { state, refs, finalize: exports.finalizeMatch };
}

test("submit 500 keeps Arena in a retryable, unconfirmed state", async () => {
  const fixture = arenaFixture([{ ok: false, body: { error: "Submission failed" } }]);
  await fixture.finalize();
  assert.equal(fixture.state.phase, "finalizing");
  assert.equal(fixture.state.error, "Submission failed");
  assert.equal(fixture.state.finalizing, false);
  assert.equal(fixture.state.submits, 1);
  await fixture.finalize();
  assert.equal(fixture.state.submits, 1);
});

test("a non-JSON submit failure still shows a useful retry error", async () => {
  const fixture = arenaFixture(["invalid-json"]);
  await fixture.finalize();
  assert.equal(fixture.state.phase, "finalizing");
  assert.match(fixture.state.error || "", /Could not finalize/);
});

test("network failure keeps local answers and a retry succeeds once", async () => {
  const fixture = arenaFixture(["network-error", { ok: true, body: { success: true, arenaRevision: 11, rank: 2, result: { score: 340, expEarned: 160 } } }]);
  await fixture.finalize();
  assert.equal(fixture.state.phase, "finalizing");
  assert.equal(fixture.state.error, "connection lost");
  await fixture.finalize(true);
  assert.equal(fixture.state.phase, "podium");
  assert.equal(fixture.state.error, null);
  assert.equal(fixture.state.submits, 2);
  assert.equal(fixture.state.score, 340);
  assert.equal(fixture.state.rank, 2);
  await fixture.finalize(true);
  assert.equal(fixture.state.submits, 2);
});

test("normal successful submit shows podium after confirmation", async () => {
  const fixture = arenaFixture([{ ok: true, body: { success: true, arenaRevision: 11, rank: 1, result: { score: 920, expEarned: 200 } } }]);
  await fixture.finalize();
  assert.equal(fixture.state.phase, "podium");
  assert.equal(fixture.refs.finalizationConfirmedRef.current, true);
  assert.equal(fixture.state.submits, 1);
  assert.equal(fixture.state.score, 920);
  assert.equal(fixture.state.rank, 1);
});

test("simultaneous finalization calls issue one submit", async () => {
  const fixture = arenaFixture([{ ok: true, body: { success: true } }]);
  const first = fixture.finalize();
  const second = fixture.finalize();
  assert.equal(fixture.state.submits, 1);
  await Promise.all([first, second]);
  assert.equal(fixture.state.phase, "podium");
  assert.equal(fixture.state.submits, 1);
});

test("completed Arena replay reads the durable score/reward without another result event", async () => {
  const f = serverFixture();
  await f.answer("a");
  await f.action("end");
  const before = JSON.stringify([...f.data.settings]);
  const eventCount = f.events.length;
  for (let i = 0; i < 2; i++) {
    const response = await f.submit("a");
    assert.equal(response.status, 200);
    assert.equal(response.body.result.score, 100);
    assert.equal(response.body.result.expEarned, 200);
  }
  assert.equal(JSON.stringify([...f.data.settings]), before);
  assert.equal(f.events.length, eventCount);
});

test("active Arena submission cannot claim a final podium or replace authoritative answers", async () => {
  const f = serverFixture();
  await f.answer("a");
  assert.equal((await f.submit("a")).status, 409);
  assert.equal(f.data.attempts.get("a").quizStatus, "in_progress");
  assert.equal(f.data.answers.size, 1);
  assert.equal((await f.answer("a", 2)).status, 200);
  assert.equal(f.read().participants.a.isFinished, true);
  assert.equal(f.read().status, "active");
});
