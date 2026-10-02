import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import crypto from "node:crypto";
import { Client } from "pg";
import { PrismaClient, type Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { loadArenaModule } from "./helpers/arena-fixture.ts";
import { createArenaRecoveryWorker } from "../src/lib/arena-recovery-worker.ts";

const configured = process.env.ARENA_CONCURRENCY_TEST_DATABASE_URL;

test("Arena expiry finalization on independent PostgreSQL connections", {
  skip: !configured ? "Dedicated isolated local Arena PostgreSQL is not configured" : false,
  timeout: 90_000,
}, async (t) => {
  // No .env/DATABASE_URL fallback, Railway, normal, demo or E2E database.
  const url = new URL(configured!);
  assert.equal(process.env.ARENA_CONCURRENCY_TEST_DATABASE_APPROVED, "true");
  assert.equal(url.protocol, "postgresql:");
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
  assert.equal(url.pathname, "/proctorshield_arena_atomic_test");
  const schema = `arena_expiry_${crypto.randomBytes(8).toString("hex")}`;
  const admin = new Client({ connectionString: configured });
  const newClient = () => new PrismaClient({ adapter: new PrismaPg({ connectionString: configured, max: 1, application_name: schema }, { schema }) });
  const one = newClient(), two = newClient();
  let clock = Date.now();
  class Clock extends Date { static now() { return clock; } }
  const events: Array<{ event: string; payload: any }> = [];
  const modules = (db: PrismaClient) => {
    const scheduled: Array<() => Promise<void>> = [];
    const arena = loadArenaModule("src/lib/arena.ts", {
      __Date: Clock, "./prisma.ts": { __esModule: true, default: db },
      "./redis.ts": { getRedis: () => null, isRedisReady: () => false },
      "./student-identity.ts": { getStudentInitials: () => "ST" },
    });
    const realtime = loadArenaModule("src/lib/arena-realtime.ts", { "./arena.ts": arena,
      "@/lib/pusher": { arenaPusher: { trigger: async (_channels: unknown, event: string, payload: any) => {
        const state = payload.quizId ? JSON.parse((await two.setting.findUniqueOrThrow({ where: { settingKey: `arena:state:${payload.quizId}` } })).settingValue!) : null;
        if (state) assert.ok(state.revision >= payload.arenaRevision, "observer sees a committed revision before event delivery");
        if (event === "arena-end") {
          assert.ok(state.finalizedAt);
          assert.equal(await two.studentQuiz.count({ where: { quizId: payload.quizId, quizStatus: "in_progress" } }), 0);
        }
        events.push({ event, payload });
      } } },
    });
    const progression = loadArenaModule("src/lib/student-progression.ts", { "./prisma.ts": { __esModule: true, default: db } });
    const finalization = loadArenaModule("src/lib/arena-finalization.ts", {
      "./arena.ts": arena, "./arena-realtime.ts": realtime, "./student-progression.ts": progression,
    });
    const recovery = loadArenaModule("src/lib/arena-recovery.ts", {
      __Date: Clock, "server-only": {}, "./prisma.ts": { __esModule: true, default: db },
      "./arena.ts": arena, "./arena-finalization.ts": finalization,
      "./arena-recovery-worker.ts": { createArenaRecoveryWorker },
      "./backup-write-gate": { runIncidentalBackupWrite: (work: () => Promise<unknown>) => work() },
    });
    const route = (file: string, userId = "teacher", role = "teacher") => loadArenaModule(`src/app/api/${file}/route.ts`, {
      __Date: Clock,
      "next/server": { NextResponse: { json: (body: any, init: any = {}) => ({ status: init.status ?? 200, body }) } },
      "@/lib/prisma": { __esModule: true, default: db },
      "@/lib/auth": { getSession: async () => ({ userId, role, fullName: userId }) },
      "@/lib/arena": arena, "@/lib/arena-finalization": finalization,
      "@/lib/arena-realtime": realtime, "@/lib/student-progression": progression,
      "@/lib/pusher": {}, "@/lib/gemini": {}, "@/lib/quiz-submission": {}, "@/lib/proctored-runtime": {},
      "@/lib/quiz-availability": { isQuizAvailable: (s: string) => s !== "deleted", quizNotAvailableResponse: () => ({ error: "Unavailable" }) },
      "@/lib/teacher-entitlements": { hasActiveProSubscription: async () => true },
      "@/lib/backup-write-gate": { withBackupWriteGate: (handler: unknown) => handler,
        scheduleTrackedBackupWork: async (_schedule: unknown, work: () => Promise<void>) => { scheduled.push(work); } },
    });
    const request = (body: object) => ({ json: async () => body });
    const params = { params: Promise.resolve({ id: "77" }) };
    return { arena, finalization, sweep: recovery.createArenaRecoverySweep(db),
      get: () => route("arena/[id]").GET(request({}), params),
      snapshot: (userId = "teacher", role = "teacher") => route("arena/[id]", userId, role).GET({ nextUrl: { searchParams: new URLSearchParams({ view: "snapshot" }) } }, params),
      callback: (id: string) => finalization.resolveArenaAttackDurably(77, id, {}, db),
      launchAttack: () => route("arena/battle-action", "b", "student").POST(request({ quizId: 77, sessionId: "session", powerType: "meteor", targetStudentId: "a" })),
      scheduledCount: () => scheduled.length,
      loseCallbacks: () => scheduled.splice(0),
      runCallbacks: async () => { for (const work of scheduled.splice(0)) await work(); },
      shield: () => route("arena/battle-action", "a", "student").POST(request({ quizId: 77, sessionId: "session", powerType: "shield", defendAttackId: "lost" })),
      end: () => route("arena/[id]").POST(request({ action: "end", sessionId: "session" }), params),
      answer: (studentId = "a") => route("quizzes/answer", studentId, "student").POST(request({ quizId: 77, questionId: 1, choiceId: 10, sessionId: "session" })),
      submit: (studentId = "a") => route("quizzes/submit", studentId, "student").POST(request({ quizId: 77, sessionId: "session", answers: { 1: 10 } })),
    };
  };
  let created = false;
  await admin.connect();
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`); created = true;
    await admin.query(`SET search_path TO "${schema}"`);
    // Use the actual relational schema/FKs/indexes in a generated isolated
    // namespace. Rewriting the baseline namespace cannot reach public data.
    for (const dir of fs.readdirSync("prisma/migrations").sort()) {
      const file = `prisma/migrations/${dir}/migration.sql`;
      if (fs.existsSync(file)) await admin.query(fs.readFileSync(file, "utf8").replaceAll('"public"', `"${schema}"`));
    }
    await admin.query(`
      INSERT INTO roles(id,role_name) VALUES(1,'teacher'),(2,'student');
      INSERT INTO users(id,full_name,email,password,role_id) VALUES
        ('teacher','Teacher','teacher@example.invalid','unused',1),('a','A','a@example.invalid','unused',2),('b','B','b@example.invalid','unused',2);
      INSERT INTO subjects(id,teacher_id,subject_name,subject_code) VALUES(1,'teacher','Isolated Arena','ISOLATED');
      INSERT INTO quizzes(id,subject_id,teacher_id,title,duration,total_questions,quiz_mode,quiz_status) VALUES(77,1,'teacher','Isolated Arena',30,1,'arena','in_progress');
      INSERT INTO questions(id,quiz_id,question_text,question_type,points) VALUES(1,77,'One','multiple_choice',100);
      INSERT INTO choices(id,question_id,choice_text,is_correct) VALUES(10,1,'Correct',true);
    `);
    const m1 = modules(one), m2 = modules(two);
    const reset = async (expired = true, scores = [100, 200]) => {
      await admin.query("TRUNCATE settings,student_quizzes,answers,violations,evidence_files,ai_analysis,notifications CASCADE");
      await one.quiz.update({ where: { id: 77 }, data: { quizStatus: "in_progress" } });
      clock = Date.now();
      await one.studentQuiz.createMany({ data: ["a", "b"].map((id) => ({ id: `attempt-${id}`, quizId: 77, studentId: id, attemptMode: "arena", quizStatus: "in_progress", startTime: new Date() })) });
      await m1.arena.mutateArena(77, async (mutation: any) => {
        const state = m1.arena.createArenaState({ quizId: 77, teacherId: "teacher", status: "active", totalQuestions: 1, sessionId: "session" });
        state.matchEndsAt = new Date(clock + (expired ? -1 : 60_000)).toISOString();
        ["a", "b"].forEach((id, i) => {
          const participant = m1.arena.ensureArenaParticipant(state, { studentId: id, studentName: id });
          participant.score = scores[i]; participant.questionsAnswered = scores[i] ? 1 : 0;
        });
        mutation.state = state;
      });
      events.splice(0);
    };
    const read = async (client = two) => {
      const state = await client.setting.findUniqueOrThrow({ where: { settingKey: "arena:state:77" } });
      return { state: JSON.parse(state.settingValue!), attempts: await client.studentQuiz.findMany({ orderBy: { studentId: "asc" } }) };
    };
    const assertFinal = async (scores = [100, 200], client = two, notifications = 4) => {
      const result = await read(client);
      assert.equal(result.state.status, "ended"); assert.ok(result.state.finalizedAt);
      assert.deepEqual(result.attempts.map((a) => Number(a.score)), scores);
      assert.ok(result.attempts.every((a) => a.quizStatus === "completed" && a.endTime && a.score !== null));
      assert.equal(await client.setting.count({ where: { settingKey: { startsWith: "arena:exp_rewarded:session:" } } }), 2);
      for (const id of ["a", "b"]) {
        const progression = await client.setting.findUniqueOrThrow({ where: { settingKey: `student:progression:${id}` } });
        const award = await client.setting.findUniqueOrThrow({ where: { settingKey: `arena:exp_rewarded:session:${id}` } });
        assert.equal(JSON.parse(progression.settingValue!).totalExp, JSON.parse(award.settingValue!).expAwarded);
        assert.equal(Number(result.attempts.find((a) => a.studentId === id)!.score), result.state.participants[id].score);
      }
      assert.equal(events.filter((e) => e.event === "arena-end").length, 1);
      assert.equal(await client.notification.count(), notifications);
    };

    // Pause a real transaction after its Arena lock (or after persisting an
    // accepted final answer), observe the independent connection blocked in
    // pg_locks, then release. Clock control makes deadline races deterministic.
    const overlap = async (first: (m: ReturnType<typeof modules>) => Promise<any>, second: () => Promise<any>, answerFirst = false) => {
      let enter!: () => void, release!: () => void;
      const entered = new Promise<void>((resolve) => { enter = resolve; });
      const resume = new Promise<void>((resolve) => { release = resolve; });
      const gated = new Proxy(one, { get(target, key) {
        if (key !== "$transaction") return Reflect.get(target, key);
        return (operation: (tx: Prisma.TransactionClient) => Promise<any>, options: any) => target.$transaction(async (tx) => {
          let held = false;
          return operation(new Proxy(tx, { get(transaction, field) {
            if (field === "$executeRaw" && !answerFirst) return async (...args: any[]) => {
              const result = await (transaction.$executeRaw as any)(...args);
              if (!held) { held = true; enter(); await resume; } return result;
            };
            if (field === "setting" && answerFirst) return new Proxy(transaction.setting, { get(delegate, method) {
              if (method !== "upsert") return Reflect.get(delegate, method);
              return async (args: any) => {
                const result = await delegate.upsert(args);
                if (args.where.settingKey === "arena:state:77" && !held) { held = true; enter(); await resume; } return result;
              };
            } });
            return Reflect.get(transaction, field);
          } }));
        }, options);
      } });
      const leading = first(modules(gated)); await entered;
      const trailing = second();
      try {
        let waited = false;
        for (let i = 0; i < 100; i++) {
          const locks = await admin.query("SELECT 1 FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid WHERE locktype='advisory' AND NOT granted AND a.application_name=$1", [schema]);
          if (locks.rowCount) { waited = true; break; }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        assert.equal(waited, true, "second PostgreSQL connection genuinely overlaps and waits");
        if (answerFirst) clock += 120_000;
      } finally { release(); }
      return Promise.all([leading, trailing]);
    };

    const seedAttack = async (due = clock - 10) => m1.arena.mutateArena(77, async (mutation: any) => {
      mutation.state.pendingAttacks = { lost: { attackId: "lost", sessionId: "session", attackerId: "b", attackerName: "B",
        targetStudentId: "a", targetName: "A", powerType: "meteor", scorePenalty: 100,
        createdAt: due - 2500, expiresAt: due, status: "pending" } };
    }, one);
    const waitForAttack = async (attackId = "lost") => {
      for (let n = 0; n < 200; n++) {
        if ((await read()).state.pendingAttacks[attackId].status === "hit") return;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      assert.fail("server worker did not recover attack without clients");
    };
    await t.test("startup after callback loss resolves persisted overdue attack exactly once with fresh-client readback", async () => {
      await reset(false, [500, 450]); await seedAttack();
      const fresh = newClient(), restarted = modules(fresh);
      const worker = createArenaRecoveryWorker(restarted.sweep, { intervalMs: 60_000 });
      try { await waitForAttack(); } finally { await worker.stop(); }
      try {
        const state = JSON.parse((await fresh.setting.findUniqueOrThrow({ where: { settingKey: "arena:state:77" } })).settingValue!);
        assert.equal(state.participants.a.score, 400); assert.equal(state.pendingAttacks.lost.status, "hit");
        await restarted.sweep(); await m1.callback("lost"); assert.equal((await read()).state.participants.a.score, 400);
        assert.equal(events.filter((e) => e.event === "arena-attack-hit").length, 1);
      } finally { await fresh.$disconnect(); }
    });
    await t.test("real attack route schedules callback; losing it and restarting worker preserves the normal callback result", async () => {
      for (const loseCallback of [false, true]) {
        await reset(false, [500, 450]); m1.loseCallbacks();
        const launched = await m1.launchAttack(); assert.equal(launched.status, 200); assert.equal(m1.scheduledCount(), 1);
        const attackId = launched.body.attackId; clock += 5000;
        if (loseCallback) {
          m1.loseCallbacks(); const fresh = newClient();
          const worker = createArenaRecoveryWorker(modules(fresh).sweep, { intervalMs: 60_000 });
          try { await waitForAttack(attackId); } finally { await worker.stop(); await fresh.$disconnect(); }
        } else await m1.runCallbacks();
        const state = (await read()).state; assert.equal(state.participants.a.score, 400);
        assert.equal(state.pendingAttacks[attackId].status, "hit");
        assert.equal(events.filter((e) => e.event === "arena-attack-hit").length, 1);
        await m2.sweep(); assert.equal((await read()).state.participants.a.score, 400);
      }
    });
    await t.test("periodic attack recovery requires no clients; snapshot reads stay read-only", async () => {
      await reset(false, [500, 450]); await seedAttack(clock + 1000);
      const before = await read();
      for (let n = 0; n < 3; n++) assert.equal((await m2.snapshot("a", "student")).status, 200);
      assert.deepEqual(await read(), before);
      const worker = createArenaRecoveryWorker(m1.sweep, { intervalMs: 10 });
      try { await new Promise((resolve) => setTimeout(resolve, 20)); clock += 2000; await waitForAttack(); }
      finally { await worker.stop(); }
      assert.equal((await read()).state.participants.a.score, 400); assert.ok(!(await read()).state.finalizedAt);
      const recovered = await read(); await m2.snapshot("a", "student"); assert.deepEqual(await read(), recovered);
    });
    for (const callbackFirst of [false, true]) await t.test(
      `attack callback vs natural expiry, callback first=${callbackFirst}, independent connections`, async () => {
        await reset(false, [500, 450]); await seedAttack(); clock += 120_000;
        await overlap((m) => callbackFirst ? m.callback("lost") : m.sweep(), () => callbackFirst ? m2.sweep() : m2.callback("lost"));
        await assertFinal([400, 450]);
        const state = (await read()).state; assert.equal(state.attackResults.lost.status, "hit");
        assert.equal(state.participants.b.rank, 1); assert.equal(events.filter((e) => e.event === "arena-attack-hit").length, 1);
      });
    for (const callbackFirst of [false, true]) await t.test(
      `attack callback vs Teacher End, callback first=${callbackFirst}, independent connections`, async () => {
        await reset(false, [500, 450]); await seedAttack();
        await overlap((m) => callbackFirst ? m.callback("lost") : m.end(), () => callbackFirst ? m2.end() : m2.callback("lost"));
        await assertFinal([400, 450]); assert.equal((await read()).state.attackResults.lost.status, "hit");
        assert.equal((await read()).state.completionReason, "teacher_end");
        assert.equal(events.filter((e) => e.event === "arena-attack-hit").length, 1);
      });
    for (const callbackFirst of [false, true]) await t.test(
      `lost/fast callback overlaps active attack sweep, callback first=${callbackFirst}`, async () => {
        await reset(false, [500, 450]); await seedAttack();
        await overlap((m) => callbackFirst ? m.callback("lost") : m.sweep(), () => callbackFirst ? m2.sweep() : m2.callback("lost"));
        assert.equal((await read()).state.participants.a.score, 400);
        assert.equal((await read()).state.pendingAttacks.lost.status, "hit");
        assert.equal(events.filter((e) => e.event === "arena-attack-hit").length, 1);
      });
    await t.test("two independent active attack workers deduct once", async () => {
      await reset(false, [500, 450]); await seedAttack();
      await overlap((m) => m.sweep(), () => m2.sweep());
      assert.equal((await read()).state.participants.a.score, 400);
      assert.equal(events.filter((e) => e.event === "arena-attack-hit").length, 1);
    });
    await t.test("timely shield at inclusive reaction boundary survives queued recovery", async () => {
      await reset(false, [500, 450]); await seedAttack(clock);
      const responses = await overlap((m) => m.shield(), () => { clock += 10; return m2.sweep(); });
      assert.equal(responses[0].status, 200); assert.equal(responses[0].body.deflected, true);
      assert.equal((await read()).state.participants.a.score, 500);
      assert.equal((await read()).state.pendingAttacks.lost.status, "deflected");
      await m2.callback("lost"); await m2.end(); await assertFinal([500, 450]);
      assert.equal((await read()).state.attackResults.lost.status, "deflected");
    });
    await t.test("overdue recovery wins against late shield without changing shield availability", async () => {
      await reset(false, [500, 450]); await seedAttack();
      await overlap((m) => m.sweep(), () => m2.shield());
      const state = (await read()).state; assert.equal(state.participants.a.score, 400);
      assert.equal(state.pendingAttacks.lost.status, "hit"); assert.ok(!state.usedPowers.a?.shield);
    });
    for (const [offset, expected] of [[-10, 400], [-1, 500], [0, 500], [10, 500]]) await t.test(
      `attack due boundary deadline offset ${offset} preserves strict existing hit/deadline rules`, async () => {
        await reset(false, [500, 450]); const deadline = Date.parse((await read()).state.matchEndsAt);
        await seedAttack(deadline + offset); clock = deadline + 100;
        await m1.sweep(); await assertFinal([expected, 450]);
        assert.equal((await read()).state.attackResults.lost.status, expected === 400 ? "hit" : "cancelled");
      });
    await t.test("attack persistence failure rolls back score/status/events and retries exactly once", async () => {
      await reset(false, [500, 450]); await seedAttack(); const before = await read();
      await admin.query(`CREATE FUNCTION fail_attack_recovery() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.setting_key='arena:state:77' THEN RAISE EXCEPTION 'injected attack persistence failure'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER fail_attack_recovery BEFORE UPDATE ON settings FOR EACH ROW EXECUTE FUNCTION fail_attack_recovery()`);
      try { assert.equal((await m1.sweep()).failed, 1); assert.deepEqual(await read(), before); assert.equal(events.length, 0); }
      finally { await admin.query("DROP TRIGGER fail_attack_recovery ON settings; DROP FUNCTION fail_attack_recovery()"); }
      assert.equal((await m2.sweep()).attacksResolved, 1); await m1.sweep();
      assert.equal((await read()).state.participants.a.score, 400); assert.equal(events.filter((e) => e.event === "arena-attack-hit").length, 1);
    });
    await t.test("repeatedly failing active attack does not block another attack or expired Arena", async () => {
      await reset(false, [500, 450]); await seedAttack();
      for (const [id, expired] of [[78, false], [79, true]] as const) {
        await one.quiz.create({ data: { id, subjectId: 1, teacherId: "teacher", title: "Recovery peer", quizMode: "arena", quizStatus: "in_progress" } });
        await one.studentQuiz.create({ data: { id: `peer-${id}`, quizId: id, studentId: "a", attemptMode: "arena", quizStatus: "in_progress", startTime: new Date() } });
        await m1.arena.mutateArena(id, async (mutation: any) => {
          const state = m1.arena.createArenaState({ quizId: id, teacherId: "teacher", status: "active", sessionId: `peer-${id}` });
          m1.arena.ensureArenaParticipant(state, { studentId: "a", studentName: "A" }).score = 500;
          state.matchEndsAt = new Date(clock + (expired ? -1 : 60_000)).toISOString();
          if (!expired) state.pendingAttacks = { peer: { ...(await read()).state.pendingAttacks.lost,
            attackId: "peer", sessionId: state.sessionId, attackerId: "a", targetStudentId: "a" } };
          mutation.state = state;
        }, one);
      }
      await admin.query(`CREATE FUNCTION fail_active_attack() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.setting_key='arena:state:77' THEN RAISE EXCEPTION 'injected active attack failure'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER fail_active_attack BEFORE UPDATE ON settings FOR EACH ROW EXECUTE FUNCTION fail_active_attack()`);
      try {
        const result = await m1.sweep(); assert.equal(result.failed, 1); assert.equal(result.finalized, 1); assert.equal(result.attacksResolved, 1);
        assert.equal(JSON.parse((await two.setting.findUniqueOrThrow({ where: { settingKey: "arena:state:78" } })).settingValue!).participants.a.score, 400);
        assert.equal((await two.studentQuiz.findUniqueOrThrow({ where: { id: "peer-79" } })).quizStatus, "completed");
        assert.equal((await m1.sweep()).failed, 1); assert.equal((await read()).state.participants.a.score, 500);
      } finally {
        await admin.query("DROP TRIGGER fail_active_attack ON settings; DROP FUNCTION fail_active_attack()");
        await one.studentQuiz.deleteMany({ where: { quizId: { in: [78, 79] } } });
        await one.quiz.deleteMany({ where: { id: { in: [78, 79] } } });
        await one.setting.deleteMany({ where: { settingKey: { in: ["arena:state:78", "arena:state:79", "arena:exp_rewarded:peer-79:a", "student:progression:a"] } } });
        await one.notification.deleteMany(); events.splice(0);
      }
      assert.equal((await m1.sweep()).attacksResolved, 1); assert.equal((await read()).state.participants.a.score, 400);
    });
    await t.test("active recovery caps one batch at 100 attacks, later sweeps drain without clients", async () => {
      await reset(false, [50_000, 450]); await seedAttack();
      await m1.arena.mutateArena(77, async (mutation: any) => {
        const attack = mutation.state.pendingAttacks.lost;
        mutation.state.pendingAttacks = Object.fromEntries(Array.from({ length: 101 }, (_, i) => [`batch-${i}`, { ...attack, attackId: `batch-${i}` }]));
      }, one);
      assert.equal((await m1.sweep()).attacksResolved, 100);
      assert.equal(Object.values((await read()).state.pendingAttacks).filter((a: any) => a.status === "pending").length, 1);
      assert.equal((await m1.sweep()).attacksResolved, 1); assert.equal((await read()).state.participants.a.score, 39_900);
      await m2.sweep(); assert.equal((await read()).state.participants.a.score, 39_900);
    });


    await t.test("natural expiry with scored/multiple participants and fresh-client readback", async () => {
      await reset(); assert.equal((await m1.get()).status, 200); await assertFinal();
      const fresh = newClient();
      try { await assertFinal([100, 200], fresh); } finally { await fresh.$disconnect(); }
    });

    await t.test("read-only client reconciliation never finalizes expired active state and preserves every completed fact", async () => {
      await reset();
      const activeBefore = await read();
      const active = await m2.snapshot("a", "student");
      assert.equal(active.status, 200); assert.equal(active.body.resultReady, false);
      assert.deepEqual(await read(), activeBefore); assert.equal(events.length, 0);
      assert.equal(await two.notification.count(), 0);
      await m1.sweep(); await assertFinal();
      const facts = async () => ({ state: await read(), settings: await two.setting.findMany({ orderBy: { settingKey: "asc" } }),
        notices: await two.notification.findMany({ orderBy: { id: "asc" } }),
        audit: await two.activityLog.findMany({ orderBy: { id: "asc" } }), quiz: await two.quiz.findUnique({ where: { id: 77 } }) });
      const before = await facts(), count = events.length;
      for (let i = 0; i < 4; i++) {
        const student = await m2.snapshot("a", "student"); assert.equal(student.status, 200);
        assert.equal(student.body.resultReady, true); assert.equal(student.body.result.score, 100);
        assert.equal(student.body.result.expEarned, 160); assert.equal(student.body.result.rank, 2);
        const teacher = await m2.snapshot(); assert.equal(teacher.status, 200);
        assert.deepEqual(Array.from(teacher.body.participants, (p: any) => p.score), [200, 100]);
        assert.equal(teacher.body.result, null);
      }
      assert.deepEqual(await facts(), before); assert.equal(events.length, count);
      assert.equal((await m2.snapshot("foreign", "teacher")).status, 404);
      assert.equal((await m2.snapshot("foreign", "student")).status, 404);
      assert.equal((await m2.snapshot("foreign", "anonymous")).status, 401);
    });
    await t.test("valid Arena points above the former 999.99 column limit survive completion/readback", async () => {
      await reset(true, [1200, 20_000]);
      assert.equal((await m1.get()).status, 200); await assertFinal([1200, 20_000]);
      const before = (await read()).attempts;
      await admin.query(fs.readFileSync("prisma/migrations/20261001010000_arena_result_score_precision/migration.sql", "utf8"));
      assert.deepEqual((await read()).attempts, before, "precision migration preserves existing results and can be retried");
    });
    for (const endFirst of [false, true]) await t.test(`Teacher End racing expiry, End first=${endFirst}`, async () => {
      await reset();
      const responses = await overlap((m) => endFirst ? m.end() : m.get(), () => endFirst ? m2.get() : m2.end());
      assert.deepEqual(responses.map((r) => r.status), [200, 200]); await assertFinal();
    });
    await t.test("accepted final answer racing expiry survives in the durable final score", async () => {
      await reset(false, [0, 0]);
      const responses = await overlap((m) => m.answer(), () => m2.get(), true);
      assert.deepEqual(responses.map((r) => r.status), [200, 200]); await assertFinal([100, 0]);
      assert.equal(await two.answer.count({ where: { studentQuizId: "attempt-a", isCorrect: true } }), 1);
      assert.equal((await read()).state.participants.a.isFinished, true);
    });
    await t.test("expiry wins against a late final answer without null/stale score", async () => {
      await reset(true, [0, 0]);
      const responses = await overlap((m) => m.get(), () => m2.answer());
      assert.deepEqual(responses.map((r) => r.status), [200, 409]); await assertFinal([0, 0]);
      assert.equal(await two.answer.count(), 0);
    });
    await t.test("duplicate expiry/submission/End awards exactly once", async () => {
      await reset(); await overlap((m) => m.get(), () => m2.submit());
      const before = await one.setting.findMany({ orderBy: { settingKey: "asc" } });
      for (const job of [m1.get, m2.submit, m1.end, m2.submit]) assert.equal((await job()).status, 200);
      assert.deepEqual(await one.setting.findMany({ orderBy: { settingKey: "asc" } }), before); await assertFinal();
    });
    await t.test("restart between play and expiry recovers only committed participant points", async () => {
      await reset(false, [0, 0]); assert.equal((await m1.answer()).status, 200);
      clock += 120_000;
      const fresh = newClient();
      try { assert.equal((await modules(fresh).submit()).status, 200); await assertFinal([100, 0], fresh); }
      finally { await fresh.$disconnect(); }
    });
    await t.test("real SQL failure after reward/attempt writes rolls back state, EXP, completion and events", async () => {
      await reset();
      const before = await read();
      await assert.rejects(m1.arena.mutateArena(77, async (mutation: any) => {
        await m1.finalization.finalizeArena(mutation);
        await mutation.tx.$executeRawUnsafe('SELECT * FROM "arena_injected_failure_missing_table"');
      }, one));
      assert.deepEqual(await read(), before);
      assert.equal(await two.setting.count({ where: { settingKey: { startsWith: "student:progression:" } } }), 0);
      assert.equal(await two.setting.count({ where: { settingKey: { startsWith: "arena:exp_rewarded:" } } }), 0);
      assert.equal((await two.quiz.findUniqueOrThrow({ where: { id: 77 } })).quizStatus, "in_progress");
      assert.equal(events.length, 0);
      assert.equal(await two.notification.count(), 0);
      assert.equal((await m2.submit()).status, 200); await assertFinal();
    });
    await t.test("Arena JSON persistence failure returns failure with full rollback and no result event", async () => {
      await reset(); const before = await read();
      const failing = new Proxy(one, { get(target, field) {
        if (field !== "$transaction") return Reflect.get(target, field);
        return (operation: (tx: Prisma.TransactionClient) => Promise<any>, options: any) => target.$transaction((tx) => operation(new Proxy(tx, { get(transaction, key) {
          if (key !== "setting") return Reflect.get(transaction, key);
          return new Proxy(transaction.setting, { get(delegate, method) {
            if (method !== "upsert") return Reflect.get(delegate, method);
            return async (args: any) => {
              if (args.where.settingKey === "arena:state:77") await tx.$executeRawUnsafe('SELECT * FROM "arena_injected_persistence_failure"');
              return delegate.upsert(args);
            };
          } });
        } })), options);
      } });
      assert.equal((await modules(failing).submit()).status, 500);
      assert.deepEqual(await read(), before);
      assert.equal(await two.setting.count({ where: { settingKey: { startsWith: "arena:exp_rewarded:" } } }), 0);
      assert.equal(await two.setting.count({ where: { settingKey: { startsWith: "student:progression:" } } }), 0);
      assert.equal(events.length, 0);
      assert.equal(await two.notification.count(), 0);
      assert.equal((await m2.get()).status, 200); await assertFinal();
    });
    await t.test("finalizer changes only latest Arena attempt and preserves historical/proctored results", async () => {
      await reset();
      await one.studentQuiz.updateMany({ data: { attemptNumber: 2 } });
      await one.studentQuiz.create({ data: { id: "historical", quizId: 77, studentId: "a", attemptNumber: 1,
        attemptMode: "proctored", quizStatus: "completed", score: 50, endTime: new Date() } });
      assert.equal((await m1.get()).status, 200);
      const historical = await two.studentQuiz.findUniqueOrThrow({ where: { id: "historical" } });
      assert.equal(Number(historical.score), 50); assert.equal(historical.attemptMode, "proctored");
      const progression = await two.setting.findUniqueOrThrow({ where: { settingKey: "student:progression:a" } });
      assert.equal(JSON.parse(progression.settingValue!).totalExp, 180 + 50 * 4 + 160);
    });
    await t.test("legacy expiry with completed null score repairs without history-bootstrap double EXP", async () => {
      await reset();
      await one.studentQuiz.updateMany({ data: { quizStatus: "completed", endTime: new Date() } });
      await one.quiz.update({ where: { id: 77 }, data: { quizStatus: "ended" } });
      await m1.arena.mutateArena(77, async (mutation: any) => { mutation.state.status = "ended"; }, one);
      assert.equal((await m2.submit()).body.result.score, 100); await assertFinal([100, 200], two, 0);
    });

    const waitForFinal = async () => {
      for (let n = 0; n < 100; n++) {
        // A database commit is visible before delivery. These normal-delivery
        // scenarios stop only after observing their event; shutdown cancellation
        // during delivery is exercised separately against real stalled HTTP.
        if (JSON.parse((await two.setting.findUniqueOrThrow({ where: { settingKey: "arena:state:77" } })).settingValue!).finalizedAt
          && events.some((event) => event.event === "arena-end")) return;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.fail("worker did not finalize without requests");
    };
    await t.test("periodic sweep finalizes expiry with no audience or HTTP requests", async () => {
      await reset(false);
      const worker = createArenaRecoveryWorker(m1.sweep, { intervalMs: 10 });
      try {
        await new Promise((resolve) => setTimeout(resolve, 20)); clock += 120_000;
        await waitForFinal();
      } finally { await worker.stop(); }
      await assertFinal(); await m2.sweep(); await assertFinal();
    });
    await t.test("startup catch-up after downtime finalizes and fresh connection reads every fact", async () => {
      await reset(false); clock += 120_000;
      const fresh = newClient();
      const restarted = modules(fresh);
      const worker = createArenaRecoveryWorker(restarted.sweep, { intervalMs: 60_000 });
      try { await waitForFinal(); await worker.stop(); await assertFinal([100, 200], fresh); }
      finally { await worker.stop(); await fresh.$disconnect(); }
    });
    await t.test("independent sweep workers overlap on the same candidate exactly once", async () => {
      await reset(); await overlap((m) => m.sweep(), () => m2.sweep()); await assertFinal();
    });
    await t.test("sweep transaction failure rolls back, does not block another Arena, and retries", async () => {
      await reset();
      await one.quiz.create({ data: { id: 78, subjectId: 1, teacherId: "teacher", title: "Second recovery fixture", quizMode: "arena", quizStatus: "in_progress", duration: 30 } });
      await one.studentQuiz.create({ data: { id: "second-a", quizId: 78, studentId: "a", attemptMode: "arena", quizStatus: "in_progress", startTime: new Date() } });
      await m1.arena.mutateArena(78, async (mutation: any) => {
        const state = m1.arena.createArenaState({ quizId: 78, teacherId: "teacher", status: "active", totalQuestions: 1, sessionId: "second" });
        state.matchEndsAt = new Date(clock - 1).toISOString();
        m1.arena.ensureArenaParticipant(state, { studentId: "a", studentName: "a" }).score = 300;
        mutation.state = state;
      }, one);
      const before = await read();
      await admin.query(`CREATE FUNCTION fail_recovery() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.setting_key='arena:state:77' THEN RAISE EXCEPTION 'injected local recovery failure'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER fail_recovery BEFORE UPDATE ON settings FOR EACH ROW EXECUTE FUNCTION fail_recovery()`);
      try {
        const result = await m1.sweep(); assert.equal(result.failed, 1); assert.equal(result.finalized, 1);
        const after = await read(); assert.deepEqual(after.state, before.state);
        assert.deepEqual(after.attempts.filter((a) => a.quizId === 77), before.attempts.filter((a) => a.quizId === 77));
        assert.equal(await two.setting.count({ where: { settingKey: { startsWith: "arena:exp_rewarded:session:" } } }), 0);
        assert.equal(events.filter((e) => e.event === "arena-end" && e.payload.quizId === 77).length, 0);
        assert.equal((await two.studentQuiz.findUniqueOrThrow({ where: { id: "second-a" } })).quizStatus, "completed");
      } finally {
        await admin.query("DROP TRIGGER fail_recovery ON settings; DROP FUNCTION fail_recovery()");
        await one.studentQuiz.delete({ where: { id: "second-a" } });
        await one.quiz.delete({ where: { id: 78 } });
        await one.setting.deleteMany({ where: { settingKey: { in: ["arena:state:78", "arena:exp_rewarded:second:a", "student:progression:a"] } } });
        await one.notification.deleteMany({}); events.splice(0);
      }
      assert.equal((await m1.sweep()).finalized, 1); await assertFinal();
    });
    await t.test("Teacher End racing sweep preserves a pre-deadline manual completion", async () => {
      await reset(false);
      const responses = await overlap((m) => m.end(), async () => { clock += 120_000; return m2.sweep(); }, true);
      assert.equal(responses[0].status, 200); await assertFinal();
      assert.equal((await read()).state.completionReason, "teacher_end");
      assert.ok((await read()).attempts.every((a) => a.remarks === null));
    });
    await t.test("sweep racing Teacher End after deadline keeps timer-expiry reason", async () => {
      await reset(); await overlap((m) => m.sweep(), () => m2.end()); await assertFinal();
      assert.equal((await read()).state.completionReason, "timer_expiry");
    });
    await t.test("final accepted answer racing sweep retains newest committed points", async () => {
      await reset(false, [0, 0]); await overlap((m) => m.answer(), async () => { clock += 120_000; return m2.sweep(); }, true);
      await assertFinal([100, 0]);
      assert.equal(await two.answer.count({ where: { studentQuizId: "attempt-a", isCorrect: true } }), 1);
    });
    const legacy = async (timer: boolean) => {
      await reset(); await m1.get();
      const end = new Date(clock - (timer ? 30_000 : 120_000));
      await one.studentQuiz.updateMany({ data: { endTime: end, remarks: timer ? "Arena match submitted automatically after the time limit expired." : null } });
      await m1.arena.mutateArena(77, async (mutation: any) => {
        delete mutation.state.finalizedAt; delete mutation.state.payouts; delete mutation.state.completionReason;
        mutation.state.endedAt = end.toISOString(); mutation.state.matchEndsAt = new Date(clock - 60_000).toISOString();
      }, one);
      events.splice(0);
    };
    for (const timer of [false, true]) await t.test(`legacy ${timer ? "timer expiry" : "manual Teacher End"} adoption preserves all historical facts and effects`, async () => {
      await legacy(timer);
      const before = await read();
      const rewards = await two.setting.findMany({ where: { settingKey: { startsWith: "arena:exp_rewarded:" } } });
      const progression = await two.setting.findMany({ where: { settingKey: { startsWith: "student:progression:" } } });
      const notices = await two.notification.findMany({ orderBy: { id: "asc" } });
      assert.equal((await m1.sweep()).finalized, 1);
      const after = await read(); assert.deepEqual(after.attempts, before.attempts);
      assert.equal(after.state.endedAt, before.state.endedAt);
      assert.equal(after.state.completionReason, timer ? "timer_expiry" : "teacher_end");
      assert.deepEqual(await two.setting.findMany({ where: { settingKey: { startsWith: "arena:exp_rewarded:" } } }), rewards);
      assert.deepEqual(await two.setting.findMany({ where: { settingKey: { startsWith: "student:progression:" } } }), progression);
      assert.deepEqual(await two.notification.findMany({ orderBy: { id: "asc" } }), notices);
      assert.equal(events.length, 0); assert.equal((await m2.sweep()).attempted, 0);
      assert.equal((await m2.submit()).body.result.deadlineExpired, timer);
      assert.equal(events.length, 0);
    });
    await t.test("legacy repair fills only missing score/reward and preserves completed metadata", async () => {
      await legacy(false);
      await one.studentQuiz.update({ where: { id: "attempt-a" }, data: { score: null, remarks: "Historical completion reason", aiVerdict: "Clean" } });
      await one.setting.delete({ where: { settingKey: "arena:exp_rewarded:session:a" } });
      await one.setting.update({ where: { settingKey: "student:progression:a" }, data: { settingValue: JSON.stringify({ studentId: "a", totalExp: 0 }) } });
      const before = await read(); const notices = await two.notification.findMany({ orderBy: { id: "asc" } });
      const rewardB = await two.setting.findUniqueOrThrow({ where: { settingKey: "arena:exp_rewarded:session:b" } });
      await m1.sweep(); const after = await read();
      assert.equal(Number(after.attempts[0].score), 100);
      assert.deepEqual({ ...after.attempts[0], score: null }, before.attempts[0]);
      assert.deepEqual(after.attempts[1], before.attempts[1]);
      assert.deepEqual(await two.setting.findUniqueOrThrow({ where: { settingKey: rewardB.settingKey } }), rewardB);
      assert.equal(JSON.parse((await two.setting.findUniqueOrThrow({ where: { settingKey: "student:progression:a" } })).settingValue!).totalExp, 160);
      assert.deepEqual(await two.notification.findMany({ orderBy: { id: "asc" } }), notices);
      const all = await two.setting.findMany({ orderBy: { settingKey: "asc" } });
      await m2.sweep(); assert.deepEqual(await two.setting.findMany({ orderBy: { settingKey: "asc" } }), all);
    });
    await t.test("bounded sweeps advance the cursor and finish a backlog on later passes", async () => {
      await reset(); await m1.get(); events.splice(0);
      const ids = Array.from({ length: 26 }, (_, i) => 300 + i);
      await one.quiz.createMany({ data: ids.map((id) => ({ id, subjectId: 1, teacherId: "teacher", title: "Bounded recovery fixture", quizMode: "arena", quizStatus: "in_progress", duration: 30 })) });
      try {
        for (const id of ids) await m1.arena.mutateArena(id, async (mutation: any) => {
          mutation.state = m1.arena.createArenaState({ quizId: id, teacherId: "teacher", status: "active", totalQuestions: 1, sessionId: `bounded-${id}` });
          mutation.state.matchEndsAt = new Date(clock - 1).toISOString();
        }, one);
        const first = await m1.sweep(); assert.equal(first.attempted, 25); assert.equal(first.finalized, 25);
        assert.equal(await two.quiz.count({ where: { id: { in: ids }, quizStatus: "in_progress" } }), 1);
        const second = await m1.sweep(); assert.equal(second.finalized, 1);
        assert.equal(await two.quiz.count({ where: { id: { in: ids }, quizStatus: "in_progress" } }), 0);
        assert.equal(events.filter((e) => e.event === "arena-end").length, 26);
      } finally {
        await one.setting.deleteMany({ where: { settingKey: { in: ids.map((id) => `arena:state:${id}`) } } });
        await one.quiz.deleteMany({ where: { id: { in: ids } } });
      }
    });
    await t.test("an aborted sweep performs no database work", async () => {
      await reset(); const controller = new AbortController(); controller.abort();
      const before = await read();
      assert.equal((await m1.sweep(controller.signal)).scanned, 0);
      assert.deepEqual(await read(), before); assert.equal(events.length, 0);
    });
  } finally {
    await Promise.allSettled([one.$disconnect(), two.$disconnect()]);
    if (created) { await admin.query("ROLLBACK"); await admin.query(`DROP SCHEMA "${schema}" CASCADE`); }
    await admin.end();
  }
});
