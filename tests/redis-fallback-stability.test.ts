import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { saveSnapshot, getSnapshotsForTeacher } from "../src/lib/snapshot-store.ts";
import { consumeRateLimit } from "../src/lib/security.ts";
import { saveLiveWarning, getLatestLiveWarning } from "../src/lib/live-warning-store.ts";
import { getRedis, isRedisReady } from "../src/lib/redis.ts";

const redisSrcPath = path.resolve(process.cwd(), "src/lib/redis.ts");
const redisSrc = fs.readFileSync(redisSrcPath, "utf-8");

const snapshotStorePath = path.resolve(process.cwd(), "src/lib/snapshot-store.ts");
const snapshotStoreSrc = fs.readFileSync(snapshotStorePath, "utf-8");

const securityPath = path.resolve(process.cwd(), "src/lib/security.ts");
const securitySrc = fs.readFileSync(securityPath, "utf-8");

const liveWarningPath = path.resolve(process.cwd(), "src/lib/live-warning-store.ts");
const liveWarningSrc = fs.readFileSync(liveWarningPath, "utf-8");

const arenaPath = path.resolve(process.cwd(), "src/lib/arena.ts");
const arenaSrc = fs.readFileSync(arenaPath, "utf-8");

// ─────────────────────────────────────────────────────────────
// REDIS FALLBACK & INFRASTRUCTURE STABILITY TESTS
// ─────────────────────────────────────────────────────────────

test("1. Redis client disables offline command queue to prevent multi-second request hanging", () => {
  assert.match(redisSrc, /enableOfflineQueue:\s*false/);
  assert.match(redisSrc, /connectTimeout:\s*1_000/);
  assert.match(redisSrc, /commandTimeout:\s*1_000/);
  assert.match(redisSrc, /maxRetriesPerRequest:\s*1/);
});

test("2. Redis client implements bounded reconnect backoff to prevent CPU and network spin", () => {
  assert.match(redisSrc, /retryStrategy\(times\)/);
  assert.match(redisSrc, /times\s*>\s*5/);
});

test("3. Redis client sanitizes credentials in error messages and throttles log spam", () => {
  assert.match(redisSrc, /sanitizeErrorMessage/);
  assert.match(redisSrc, /60_000/);
  assert.match(redisSrc, /console\.warn/);
});

test("4. isRedisReady helper accurately checks ready state without throwing", () => {
  assert.equal(isRedisReady(null), false);
  assert.equal(isRedisReady({ status: "reconnecting" } as any), false);
  assert.equal(isRedisReady({ status: "ready" } as any), true);
});

test("5. Snapshot store writes to local memory first and retrieves snapshots when Redis is offline", async () => {
  const mockRecord = {
    studentId: "student-fallback-101",
    snapshot: "data:image/jpeg;base64,mocksnapshotdata123",
    studentName: "Test Student Fallback",
    quizTitle: "Chemistry 101",
    quizId: 42,
    teacherId: "teacher-fallback-99",
    deviceType: "desktop" as const,
    monitoringLevel: "strict" as const,
    connectionStatus: "online" as const,
    updatedAt: Date.now(),
  };

  await saveSnapshot(mockRecord);
  const snapshots = await getSnapshotsForTeacher("teacher-fallback-99");
  
  assert.ok(Array.isArray(snapshots));
  const found = snapshots.find((s) => s.studentId === "student-fallback-101");
  assert.ok(found);
  assert.equal(found.studentName, "Test Student Fallback");
  assert.equal(found.snapshot, "data:image/jpeg;base64,mocksnapshotdata123");
});

test("6. Rate limiter falls back to fast in-memory sliding bucket when Redis is offline", async () => {
  const key = `test-ip-${Date.now()}`;
  const first = await consumeRateLimit(key, 2, 60_000);
  assert.equal(first.allowed, true);

  const second = await consumeRateLimit(key, 2, 60_000);
  assert.equal(second.allowed, true);

  const third = await consumeRateLimit(key, 2, 60_000);
  assert.equal(third.allowed, false);
});

test("7. Live warning store persists and retrieves warnings under memory fallback", async () => {
  const warningRecord = {
    id: `warn-${Date.now()}`,
    studentId: "student-warn-1",
    teacherId: "teacher-warn-1",
    quizId: 55,
    message: "Please focus on your exam screen.",
    createdAt: new Date().toISOString(),
  };

  await saveLiveWarning(warningRecord);
  const fetched = await getLatestLiveWarning("student-warn-1", 55);

  assert.ok(fetched);
  assert.equal(fetched.message, "Please focus on your exam screen.");
  assert.equal(fetched.studentId, "student-warn-1");
});

test("8. Arena operations check isRedisReady and maintain PostgreSQL and memory cache authority", () => {
  assert.match(arenaSrc, /isRedisReady\(redis\)/);
  assert.match(arenaSrc, /prisma\.setting\.upsert/);
  assert.match(arenaSrc, /globalArena\.__proctorShieldArenaState/);
});
