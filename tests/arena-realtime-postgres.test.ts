import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import crypto from "node:crypto";
import Pusher from "pusher";
import { Client } from "pg";
import { PrismaClient, type Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { loadArenaModule } from "./helpers/arena-fixture.ts";
import { arenaHttpReceiver, waitForArenaCondition } from "./helpers/arena-http-receiver.ts";
import { createArenaPusherDelivery } from "../src/lib/arena-pusher-transport.ts";
import { createArenaRecoveryWorker } from "../src/lib/arena-recovery-worker.ts";

const configured = process.env.ARENA_CONCURRENCY_TEST_DATABASE_URL;

test("real PostgreSQL Arena recovery with cancellable stalled HTTP delivery", {
  skip: !configured ? "Dedicated isolated local Arena PostgreSQL is not configured" : false,
  timeout: 90_000,
}, async (t) => {
  const url = new URL(configured!);
  assert.equal(process.env.ARENA_CONCURRENCY_TEST_DATABASE_APPROVED, "true");
  assert.equal(url.protocol, "postgresql:");
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
  assert.equal(url.pathname, "/proctorshield_arena_atomic_test");
  const schema = `arena_transport_${crypto.randomBytes(8).toString("hex")}`;
  const admin = new Client({ connectionString: configured });
  const newClient = () => new PrismaClient({ adapter: new PrismaPg({ connectionString: configured, max: 1, application_name: schema }, { schema }) });
  const one = newClient(), two = newClient();
  const receiver = await arenaHttpReceiver();
  const signer = new Pusher({ appId: "123", key: "isolated-key", secret: "isolated-secret", cluster: "mt1" });
  const warnings: unknown[][] = [];
  const workers: Array<ReturnType<typeof createArenaRecoveryWorker>> = [];
  const modules = (db: PrismaClient, timeoutMs = 150) => {
    const arena = loadArenaModule("src/lib/arena.ts", {
      __warnings: warnings, "./prisma.ts": { __esModule: true, default: db },
      "./redis.ts": { getRedis: () => null, isRedisReady: () => false },
      "./student-identity.ts": { getStudentInitials: () => "ST" },
    });
    const realtime = loadArenaModule("src/lib/arena-realtime.ts", { "./arena.ts": arena,
      "@/lib/pusher": { arenaPusher: createArenaPusherDelivery({ appId: "123", cluster: "mt1", signer, endpoint: receiver.endpoint, timeoutMs }) },
    });
    const progression = loadArenaModule("src/lib/student-progression.ts", { "./prisma.ts": { __esModule: true, default: db } });
    const finalization = loadArenaModule("src/lib/arena-finalization.ts", {
      "./arena.ts": arena, "./arena-realtime.ts": realtime, "./student-progression.ts": progression,
    });
    const recovery = loadArenaModule("src/lib/arena-recovery.ts", {
      "server-only": {}, "./prisma.ts": { __esModule: true, default: db },
      "./arena.ts": arena, "./arena-finalization.ts": finalization,
      "./arena-recovery-worker.ts": { createArenaRecoveryWorker },
      "./backup-write-gate": { runIncidentalBackupWrite: (work: () => Promise<unknown>) => work() },
    });
    return { arena, realtime, sweep: recovery.createArenaRecoverySweep(db) };
  };
  const m1 = modules(one), m2 = modules(two);
  const reset = async () => {
    for (const worker of workers.splice(0)) await worker.stop();
    await waitForArenaCondition(() => receiver.sockets.size === 0);
    receiver.requests.splice(0); warnings.splice(0); receiver.setBehavior(() => "success");
    await admin.query("TRUNCATE settings,student_quizzes,answers,violations,evidence_files,ai_analysis,notifications CASCADE");
    await one.quiz.updateMany({ data: { quizStatus: "in_progress" } });
    for (const [quizId, studentId, score] of [[77, "a", 100], [78, "b", 200]] as const) {
      await one.studentQuiz.create({ data: { id: `attempt-${studentId}`, studentId, quizId, attemptMode: "arena", quizStatus: "in_progress", startTime: new Date() } });
      await m1.arena.mutateArena(quizId, async (mutation: any) => {
        const state = m1.arena.createArenaState({ quizId, teacherId: "teacher", status: "active", totalQuestions: 1, sessionId: `session-${quizId}` });
        state.matchEndsAt = new Date(Date.now() - 1_000).toISOString();
        const participant = m1.arena.ensureArenaParticipant(state, { studentId, studentName: studentId });
        participant.score = score; participant.questionsAnswered = 1;
        mutation.state = state;
      });
    }
  };
  const assertFinal = async (quizIds = [77, 78], client = two) => {
    for (const quizId of quizIds) {
      const id = quizId === 77 ? "a" : "b", score = quizId === 77 ? 100 : 200;
      const state = JSON.parse((await client.setting.findUniqueOrThrow({ where: { settingKey: `arena:state:${quizId}` } })).settingValue!);
      const attempt = await client.studentQuiz.findUniqueOrThrow({ where: { id: `attempt-${id}` } });
      assert.equal(state.status, "ended"); assert.ok(state.finalizedAt); assert.ok(state.payouts);
      assert.equal(state.participants[id].score, score);
      assert.equal(Number(attempt.score), score); assert.equal(attempt.quizStatus, "completed"); assert.ok(attempt.endTime);
      const award = JSON.parse((await client.setting.findUniqueOrThrow({ where: { settingKey: `arena:exp_rewarded:session-${quizId}:${id}` } })).settingValue!);
      const progression = JSON.parse((await client.setting.findUniqueOrThrow({ where: { settingKey: `student:progression:${id}` } })).settingValue!);
      assert.equal(progression.totalExp, award.expAwarded);
      assert.equal(await client.notification.count({ where: { userId: id } }), 1);
    }
    assert.equal(await client.notification.count({ where: { userId: "teacher" } }), quizIds.length);
    assert.equal(await client.setting.count({ where: { settingKey: { startsWith: "arena:exp_rewarded:" } } }), quizIds.length);
  };
  const assertNoLocks = async () => assert.equal((await admin.query("SELECT count(*)::int AS count FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid WHERE locktype='advisory' AND a.application_name=$1", [schema])).rows[0].count, 0);
  let created = false;
  await admin.connect();
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`); created = true;
    await admin.query(`SET search_path TO "${schema}"`);
    for (const dir of fs.readdirSync("prisma/migrations").sort()) {
      const file = `prisma/migrations/${dir}/migration.sql`;
      if (fs.existsSync(file)) await admin.query(fs.readFileSync(file, "utf8").replaceAll('"public"', `"${schema}"`));
    }
    await admin.query(`
      INSERT INTO roles(id,role_name) VALUES(1,'teacher'),(2,'student');
      INSERT INTO users(id,full_name,email,password,role_id) VALUES
        ('teacher','Teacher','teacher@example.invalid','unused',1),('a','A','a@example.invalid','unused',2),('b','B','b@example.invalid','unused',2);
      INSERT INTO subjects(id,teacher_id,subject_name,subject_code) VALUES(1,'teacher','Isolated Arena','ISOLATED');
      INSERT INTO quizzes(id,subject_id,teacher_id,title,duration,total_questions,quiz_mode,quiz_status) VALUES
        (77,1,'teacher','Isolated A',30,1,'arena','in_progress'),(78,1,'teacher','Isolated B',30,1,'arena','in_progress');
    `);

    await t.test("stalled A times out; B finalizes in the same sweep; replay and fresh read preserve exactly-once facts", async () => {
      await reset(); receiver.setBehavior((event) => event.data.quizId === 77 ? "stall" : "success");
      const began = Date.now(); const result = await m1.sweep();
      assert.equal(result.finalized, 2); assert.equal(result.failed, 0); assert.ok(Date.now() - began < 5_000);
      await waitForArenaCondition(() => receiver.sockets.size === 0); await assertFinal(); await assertNoLocks();
      assert.ok(warnings.some((warning) => JSON.stringify(warning).includes('"reason":"timeout"')));
      assert.equal(receiver.requests.filter((r) => r.data.quizId === 77).length, 1, "failed batch skips further events, not the next Arena");
      const count = receiver.requests.length, before = await two.setting.findMany({ orderBy: { settingKey: "asc" } });
      await m2.sweep(); await assertFinal();
      assert.equal(receiver.requests.length, count); assert.deepEqual(await two.setting.findMany({ orderBy: { settingKey: "asc" } }), before);
      const fresh = newClient(); try { await assertFinal([77, 78], fresh); } finally { await fresh.$disconnect(); }
    });

    await t.test("shutdown aborts stalled HTTP and drains committed work without admitting B", async () => {
      await reset(); receiver.setBehavior(() => "stall");
      const worker = createArenaRecoveryWorker(modules(one, 1_500).sweep); workers.push(worker);
      await waitForArenaCondition(() => receiver.requests.length === 1);
      await assertFinal([77]); await assertNoLocks();
      const began = Date.now(); await worker.stop();
      assert.ok(Date.now() - began < 1_000); await waitForArenaCondition(() => receiver.sockets.size === 0);
      assert.ok(warnings.some((warning) => JSON.stringify(warning).includes('"reason":"cancelled"')));
      assert.equal((await two.studentQuiz.findUniqueOrThrow({ where: { id: "attempt-b" } })).quizStatus, "in_progress");
      receiver.setBehavior(() => "success"); await m2.sweep(); await assertFinal();
    });

    await t.test("shutdown during a DB transaction drains its commit; cancelled post-commit batch never opens HTTP", async () => {
      await reset(); let enter!: () => void, release!: () => void;
      const entered = new Promise<void>((resolve) => { enter = resolve; });
      const resume = new Promise<void>((resolve) => { release = resolve; });
      const gated = new Proxy(one, { get(target, key) {
        if (key !== "$transaction") return Reflect.get(target, key);
        return (operation: (tx: Prisma.TransactionClient) => Promise<any>, options: any) => target.$transaction(async (tx) => {
          let held = false;
          return operation(new Proxy(tx, { get(transaction, field) {
            if (field === "$executeRaw") return async (...args: any[]) => {
              const result = await (transaction.$executeRaw as any)(...args);
              if (!held) { held = true; enter(); await resume; } return result;
            };
            return Reflect.get(transaction, field);
          } }));
        }, options);
      } });
      const worker = createArenaRecoveryWorker(modules(gated).sweep); workers.push(worker);
      await entered; let stopped = false;
      const stopping = worker.stop().then(() => { stopped = true; });
      try {
        await new Promise((resolve) => setTimeout(resolve, 30));
        assert.equal(stopped, false); assert.equal(receiver.requests.length, 0);
        assert.equal((await two.studentQuiz.findUniqueOrThrow({ where: { id: "attempt-a" } })).quizStatus, "in_progress");
      } finally { release(); }
      await stopping; await assertFinal([77]); await assertNoLocks();
      assert.equal(receiver.requests.length, 0); assert.equal(receiver.sockets.size, 0);
      await m2.sweep(); await assertFinal();
    });

    await t.test("independent recovery worker progresses while A delivery stalls; neither duplicates finalization", async () => {
      await reset(); receiver.setBehavior((event) => event.data.quizId === 77 ? "stall" : "success");
      const first = modules(one, 1_500).sweep();
      await waitForArenaCondition(() => receiver.requests.length === 1);
      await assertFinal([77]); await assertNoLocks();
      const second = await m2.sweep(); assert.equal(second.finalized, 1);
      await assertFinal(); await first;
      await waitForArenaCondition(() => receiver.sockets.size === 0);
      assert.equal(receiver.requests.filter((r) => r.data.quizId === 77).length, 1);
      assert.equal(receiver.requests.filter((r) => r.name === "arena-end" && r.data.quizId === 78).length, 1);
      await m1.sweep(); await assertFinal();
    });

    await t.test("successful HTTP delivers committed result events; rejected provider response leaves finalization durable", async () => {
      await reset(); await m1.sweep(); await assertFinal();
      assert.equal(receiver.requests.filter((r) => r.name === "arena-end").length, 2);
      await waitForArenaCondition(() => receiver.sockets.size === 0);
      await reset(); receiver.setBehavior(() => "reject");
      const result = await m1.sweep(); assert.equal(result.finalized, 2); await assertFinal();
      assert.equal(receiver.requests.length, 2); // One rejected attempt per candidate, no pretend result success.
      assert.ok(warnings.some((warning) => JSON.stringify(warning).includes('"reason":"rejected"')));
      const log = JSON.stringify(warnings);
      for (const sensitive of ["isolated-key", "isolated-secret", "auth_signature", "private-provider", "http:"]) assert.ok(!log.includes(sensitive));
      await waitForArenaCondition(() => receiver.sockets.size === 0); await assertNoLocks();
    });

    await t.test("overdue attack commits once despite stalled real HTTP; unrelated expiry still progresses", async () => {
      await reset(); receiver.setBehavior(() => "stall");
      await m1.arena.mutateArena(77, async (mutation: any) => {
        const state = mutation.state;
        state.matchEndsAt = new Date(Date.now() + 60_000).toISOString();
        state.participants.a.score = 500;
        m1.arena.ensureArenaParticipant(state, { studentId: "b", studentName: "B" }).score = 450;
        state.pendingAttacks = { lost: { attackId: "lost", sessionId: state.sessionId,
          attackerId: "b", attackerName: "B", targetStudentId: "a", targetName: "A", powerType: "meteor",
          scorePenalty: 100, createdAt: Date.now() - 10_000, expiresAt: Date.now() - 1000, status: "pending" } };
      }, one);
      const result = await m1.sweep(); assert.equal(result.attacksResolved, 1); assert.equal(result.finalized, 1);
      const state = JSON.parse((await two.setting.findUniqueOrThrow({ where: { settingKey: "arena:state:77" } })).settingValue!);
      assert.equal(state.participants.a.score, 400); assert.equal(state.pendingAttacks.lost.status, "hit"); assert.ok(!state.finalizedAt);
      assert.equal((await two.studentQuiz.findUniqueOrThrow({ where: { id: "attempt-b" } })).quizStatus, "completed");
      await waitForArenaCondition(() => receiver.sockets.size === 0); await assertNoLocks();
      const count = receiver.requests.length; await m2.sweep(); assert.equal(receiver.requests.length, count);
      const fresh = newClient();
      try { assert.equal(JSON.parse((await fresh.setting.findUniqueOrThrow({ where: { settingKey: "arena:state:77" } })).settingValue!).participants.a.score, 400); }
      finally { await fresh.$disconnect(); }
    });
    await t.test("total post-commit deadline cancels real transport and still executes non-realtime effects", async () => {
      await reset(); receiver.setBehavior(() => "stall"); let ran = false;
      const before = Date.now();
      await m1.arena.mutateArena(77, async (mutation: any) => {
        mutation.state.participants.a.score = 101;
        await m1.realtime.arenaRealtime(mutation).trigger("private-arena-77", "budget-test", { quizId: 77 });
        mutation.afterCommit(async () => { ran = true; });
      }, one, { realtimeBudgetMs: 50 });
      assert.ok(Date.now() - before < 1_000); assert.equal(ran, true);
      assert.equal(JSON.parse((await two.setting.findUniqueOrThrow({ where: { settingKey: "arena:state:77" } })).settingValue!).participants.a.score, 101);
      await waitForArenaCondition(() => receiver.sockets.size === 0); await assertNoLocks();
    });
  } finally {
    for (const worker of workers) await worker.stop();
    await one.$disconnect(); await two.$disconnect();
    await receiver.close();
    if (created) await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  }
});
