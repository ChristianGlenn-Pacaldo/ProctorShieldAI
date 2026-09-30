import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";
import { Client } from "pg";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { loadArenaModule } from "./helpers/arena-fixture.ts";

const configured = process.env.ARENA_CONCURRENCY_TEST_DATABASE_URL;

// Never fall back to DATABASE_URL, .env, staging, demo or E2E. Opt-in requires
// an explicitly disposable loopback database with this exact separate name.
test("PostgreSQL independent connections serialize Arena mutations and roll back failures", {
  skip: !configured ? "Dedicated local disposable PostgreSQL is not configured" : false,
}, async () => {
  const url = new URL(configured!);
  assert.equal(process.env.ARENA_CONCURRENCY_TEST_DATABASE_APPROVED, "true");
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
  assert.equal(url.protocol, "postgresql:");
  assert.equal(url.pathname, "/proctorshield_arena_atomic_test");
  const schema = `arena_atomic_${crypto.randomBytes(8).toString("hex")}`;
  const admin = new Client({ connectionString: configured });
  const one = new PrismaClient({ adapter: new PrismaPg({ connectionString: configured, max: 1 }, { schema }) });
  const two = new PrismaClient({ adapter: new PrismaPg({ connectionString: configured, max: 1 }, { schema }) });
  const arena = loadArenaModule("src/lib/arena.ts", {
    "./prisma.ts": { __esModule: true, default: one },
    "./redis.ts": { getRedis: () => null, isRedisReady: () => false },
    "./student-identity.ts": { getStudentInitials: () => "ST" },
  });
  let schemaCreated = false;
  await admin.connect();
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    schemaCreated = true;
    await admin.query(`CREATE TABLE "${schema}".settings (
      id SERIAL PRIMARY KEY, setting_key TEXT UNIQUE NOT NULL,
      setting_value TEXT, updated_at TIMESTAMP NOT NULL DEFAULT now()
    )`);
    await arena.mutateArena(77, async (m: any) => {
      m.state = arena.createArenaState({ quizId: 77, teacherId: "teacher", status: "active", sessionId: "test-session" });
    }, one);
    let locked!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => { locked = resolve; });
    const resume = new Promise<void>((resolve) => { release = resolve; });
    const first = arena.mutateArena(77, async (m: any) => {
      locked(); await resume;
      arena.ensureArenaParticipant(m.state, { studentId: "a", studentName: "A" });
    }, one);
    await entered;
    let secondEntered = false;
    const second = arena.mutateArena(77, async (m: any) => {
      secondEntered = true;
      assert.ok(m.state.participants.a, "second connection must read the first commit after locking");
      arena.ensureArenaParticipant(m.state, { studentId: "b", studentName: "B" });
    }, two);
    try {
      // A bounded poll observes PostgreSQL's actual advisory-lock wait.
      let observedWait = false;
      for (let i = 0; i < 100; i++) {
        const waiting = await admin.query("SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND NOT granted AND database = (SELECT oid FROM pg_database WHERE datname = current_database())");
        if (waiting.rowCount) { observedWait = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.equal(observedWait, true, "independent connection must wait for the database lock");
      assert.equal(secondEntered, false);
    } finally { release(); }
    await Promise.all([first, second]);
    const readback = await arena.getArenaState(77, two);
    assert.deepEqual(Object.keys(readback.participants).sort(), ["a", "b"]);
    await assert.rejects(arena.mutateArena(77, async (m: any) => {
      m.state.participants.a.score = 999;
      // A real relational failure must roll back the entire transaction.
      await m.tx.$executeRawUnsafe('SELECT * FROM "arena_deliberately_missing_table"');
    }, one));
    assert.equal((await arena.getArenaState(77, two)).participants.a.score, 0);
  } finally {
    await Promise.allSettled([one.$disconnect(), two.$disconnect()]);
    // schema is generated above, never a supplied identifier or public schema.
    if (schemaCreated) await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  }
});
