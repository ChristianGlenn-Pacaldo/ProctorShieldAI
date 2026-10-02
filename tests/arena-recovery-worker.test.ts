import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { createArenaRecoveryWorker } from "../src/lib/arena-recovery-worker.ts";
import { loadArenaModule } from "./helpers/arena-fixture.ts";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(check: () => boolean) {
  for (let n = 0; n < 500; n++) {
    if (check()) return;
    await delay(10);
  }
  assert.fail("worker did not make progress");
}

test("worker catches up immediately, runs periodically without overlap, and stops during a run", async () => {
  let calls = 0, active = 0, peak = 0;
  const worker = createArenaRecoveryWorker(async () => {
    calls++; active++; peak = Math.max(peak, active);
    await delay(10); active--;
  }, { intervalMs: 1 });
  try {
    assert.equal(calls, 1);
    await waitFor(() => calls >= 2);
    assert.ok(calls >= 2); assert.equal(peak, 1);
  } finally { await worker.stop(); }
  const stoppedAt = calls;
  assert.equal(active, 0);
  await delay(20); assert.equal(calls, stoppedAt);
});

test("failed sweep is retried and stop cancels scheduled work", async () => {
  let calls = 0, errors = 0;
  const worker = createArenaRecoveryWorker(async () => {
    calls++; if (calls === 1) throw new Error("private detail");
  }, { intervalMs: 2, onError: () => { errors++; } });
  await waitFor(() => calls >= 2); await worker.stop();
  assert.ok(calls >= 2); assert.equal(errors, 1);
  const stoppedAt = calls; await delay(10); assert.equal(calls, stoppedAt);
});

test("shutdown signals an in-flight batch and drains it without scheduling another", async () => {
  let entered!: () => void;
  const entry = new Promise<void>((resolve) => { entered = resolve; });
  let aborted = false, calls = 0;
  const worker = createArenaRecoveryWorker(async (signal) => {
    calls++; entered();
    await new Promise<void>((resolve) => signal.addEventListener("abort", () => { aborted = true; resolve(); }, { once: true }));
  });
  await entry; await worker.stop(); assert.equal(aborted, true); assert.equal(calls, 1);
});

test("unref'ed idle worker does not leave a child test/tooling process hanging", () => {
  const child = spawnSync(process.execPath, ["--input-type=module", "-e",
    "import {createArenaRecoveryWorker} from './src/lib/arena-recovery-worker.ts'; createArenaRecoveryWorker(async()=>{}, {intervalMs:60000});"],
  { cwd: process.cwd(), timeout: 30_000, encoding: "utf8", env: { ...process.env, NODE_TEST_CONTEXT: "" } });
  assert.equal(child.error, undefined); assert.equal(child.status, 0);
});

test("instrumentation imports/starts recovery only in the production Node server", async () => {
  let starts = 0;
  for (const extra of [{ NODE_ENV: "test" }, { NODE_ENV: "development" }, { NEXT_RUNTIME: "edge" },
    { NEXT_PHASE: "phase-production-build" }, { NEXT_PHASE: "phase-export" }, { NODE_TEST_CONTEXT: "child-v8" },
    { JEST_WORKER_ID: "1" }, { VITEST: "true" }, { FRONTEND_ONLY: "true" }, {}]) {
    const hook = loadArenaModule("src/instrumentation.ts", {
      __process: { env: { NODE_ENV: "production", NEXT_RUNTIME: "nodejs", ...extra } },
      "./lib/arena-recovery": { startArenaRecovery() { starts++; } },
    });
    await hook.register();
  }
  assert.equal(starts, 1);
});

test("runtime registration is a singleton and shutdown removes every worker signal listener", async () => {
  const runtimeProcess = new EventEmitter();
  let scans = 0;
  const db = { setting: { async findMany() { scans++; return []; } } };
  const recovery = loadArenaModule("src/lib/arena-recovery.ts", {
    __process: runtimeProcess, "server-only": {}, "./prisma.ts": { __esModule: true, default: db },
    "./arena.ts": {}, "./arena-finalization.ts": {}, "./backup-write-gate": {},
    "./arena-recovery-worker.ts": { createArenaRecoveryWorker },
  });
  const one = recovery.startArenaRecovery(), two = recovery.startArenaRecovery();
  assert.equal(one, two);
  try {
    await waitFor(() => scans === 1);
    assert.equal(runtimeProcess.listenerCount("SIGTERM"), 1);
    runtimeProcess.emit("SIGTERM");
  } finally { await one.stop(); }
  for (const event of ["SIGTERM", "SIGINT", "beforeExit"]) assert.equal(runtimeProcess.listenerCount(event), 0);
  const restarted = recovery.startArenaRecovery(); assert.notEqual(restarted, one);
  await restarted.stop(); assert.equal(scans, 2);
});
