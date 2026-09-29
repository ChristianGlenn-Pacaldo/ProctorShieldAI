import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

type FileRow = {
  id: bigint;
  owner: string;
  filePath: string;
  uploadedAt: Date;
  deletionRequestedAt: Date | null;
  deletedAt: Date | null;
};
type ViolationRow = { owner: string; createdAt: Date; screenshotPath: string | null; violationType: string };
const now = new Date("2026-09-29T12:00:00.000Z");
const old = new Date("2026-05-01T12:00:00.000Z");
const recent = new Date("2026-09-28T12:00:00.000Z");

function loadModule(relativePath: string, dependencies: Record<string, unknown>, globals: Record<string, unknown> = {}) {
  const absolutePath = path.resolve(process.cwd(), relativePath);
  const code = ts.transpileModule(fs.readFileSync(absolutePath, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const sandboxModule = { exports: {} as Record<string, any> };
  vm.runInNewContext(code, {
    module: sandboxModule, exports: sandboxModule.exports, console, Date, Buffer, process, AbortController, setTimeout, clearTimeout, ...globals,
    require: (name: string) => {
      if (name in dependencies) return dependencies[name];
      throw new Error(`Unexpected dependency: ${name}`);
    },
  }, { filename: absolutePath });
  return sandboxModule.exports;
}

function fixture(files: FileRow[], violations: ViolationRow[], retentionValue = "90") {
  const state = { files, violations, objects: new Set(files.map((file) => file.filePath)), deleted: [] as string[] };
  let failTransaction = false;
  let failFinalize = false;
  let failStorage = false;
  const matchesFile = (file: FileRow, where: any) =>
    (!where.id || file.id === where.id) &&
    (!where.violation || file.owner === where.violation.studentQuiz.quiz.teacherId) &&
    (!where.uploadedAt?.lt || file.uploadedAt < where.uploadedAt.lt) &&
    (!where.uploadedAt?.gte || file.uploadedAt >= where.uploadedAt.gte) &&
    (where.deletionRequestedAt !== null || file.deletionRequestedAt === null) &&
    (where.deletionRequestedAt?.not !== null || file.deletionRequestedAt !== null) &&
    (where.deletedAt !== null || file.deletedAt === null);
  const matchesViolation = (violation: ViolationRow, where: any) =>
    (!where.studentQuiz || violation.owner === where.studentQuiz.quiz.teacherId) &&
    (!where.createdAt?.lt || violation.createdAt < where.createdAt.lt) &&
    (!where.createdAt?.gte || violation.createdAt >= where.createdAt.gte) &&
    (where.screenshotPath?.not !== null || violation.screenshotPath !== null);
  const db = {
    setting: {
      findUnique: async () => ({ settingValue: retentionValue }),
      findMany: async () => [
        { settingKey: "evidence_retention_days", settingValue: retentionValue },
        { settingKey: "webhook_retention_days", settingValue: "365" },
      ],
    },
    evidenceFile: {
      findFirst: async ({ where }: any) => state.files.find((file) => matchesFile(file, where)) || null,
      findMany: async ({ where, take }: any) => state.files.filter((file) => matchesFile(file, where))
        .sort((a, b) => Number(a.id - b.id)).slice(0, take)
        .map((file) => ({ id: file.id, filePath: file.filePath })),
      updateMany: async ({ where, data }: any) => {
        if (failFinalize && data.deletedAt) throw new Error("database finalize failed");
        const selected = state.files.filter((file) => matchesFile(file, where));
        for (const file of selected) Object.assign(file, data);
        return { count: selected.length };
      },
    },
    violation: {
      findFirst: async ({ where }: any) => state.violations.find((violation) => matchesViolation(violation, where)) || null,
      updateMany: async ({ where, data }: any) => {
        const selected = state.violations.filter((violation) => matchesViolation(violation, where));
        for (const violation of selected) Object.assign(violation, data);
        return { count: selected.length };
      },
    },
    userSubscription: { updateMany: async () => ({ count: 0 }) },
    otpCode: { deleteMany: async () => ({ count: 0 }) },
    webhookEvent: { deleteMany: async () => ({ count: 0 }) },
    user: { updateMany: async () => ({ count: 0 }) },
    $transaction: async (callback: (tx: any) => Promise<unknown>) => {
      if (failTransaction) throw new Error("database transaction failed");
      const before = structuredClone({ files: state.files, violations: state.violations });
      try { return await callback(db); }
      catch (error) {
        state.files.splice(0, state.files.length, ...before.files);
        state.violations.splice(0, state.violations.length, ...before.violations);
        throw error;
      }
    },
  };
  const storage = { deleteEvidence: async ([key]: string[]) => {
    if (failStorage) throw new Error("S3 unavailable");
    state.objects.delete(key);
    state.deleted.push(key);
  } };
  const retention = loadModule("src/lib/evidence-retention.ts", { "./prisma": { __esModule: true, default: db }, "./evidence-storage": storage });
  const maintenance = loadModule("src/lib/maintenance.ts", { "./prisma": { __esModule: true, default: db }, "./evidence-retention": retention });
  return {
    state, db, retention, maintenance,
    failTransaction: (value: boolean) => { failTransaction = value; },
    failFinalize: (value: boolean) => { failFinalize = value; },
    failStorage: (value: boolean) => { failStorage = value; },
  };
}

function file(id: number, owner: string, uploadedAt = old): FileRow {
  return { id: BigInt(id), owner, filePath: `evidence/quiz/${id}.webm`, uploadedAt, deletionRequestedAt: null, deletedAt: null };
}
function violation(owner: string, createdAt = old, screenshotPath: string | null = "data:image/png;base64,QQ=="): ViolationRow {
  return { owner, createdAt, screenshotPath, violationType: "tab_switch" };
}

test("Teacher purge is owner scoped and preserves violation audit metadata", async () => {
  const f = fixture([file(1, "teacher-a"), file(2, "teacher-b")], [violation("teacher-a"), violation("teacher-b")]);
  const result = await f.retention.requestTeacherEvidencePurge("teacher-a", now);
  assert.equal(result.queuedEvidenceFiles, 1);
  assert.equal(f.state.files[0].deletionRequestedAt?.toISOString(), now.toISOString());
  assert.equal(f.state.files[1].deletionRequestedAt, null);
  assert.equal(f.state.violations[0].screenshotPath, null);
  assert.ok(f.state.violations[1].screenshotPath);
  assert.equal(f.state.violations[0].violationType, "tab_switch");
  assert.equal(f.state.violations.length, 2);
  assert.equal(f.state.objects.size, 2);
});

test("Teacher bulk purge rejects recent evidence without changing old or other owners' records", async () => {
  const f = fixture([file(1, "teacher-a"), file(2, "teacher-a", recent), file(3, "teacher-b")],
    [violation("teacher-a"), violation("teacher-a", recent), violation("teacher-b")]);
  await assert.rejects(f.retention.requestTeacherEvidencePurge("teacher-a", now), /newer than 90 days/);
  assert.ok(f.state.files.every((item) => item.deletionRequestedAt === null));
  assert.equal(f.state.violations.length, 3);
  assert.equal(f.state.objects.size, 3);
});

test("maintenance deletes expired media after commit and repeated runs are idempotent", async () => {
  const f = fixture([file(1, "teacher-a"), file(2, "teacher-a", recent)], [violation("teacher-a"), violation("teacher-a", recent)]);
  const first = await f.maintenance.runMaintenance(now);
  assert.equal(first.queuedEvidenceFiles, 1);
  assert.equal(first.removedEvidenceFiles, 1);
  assert.equal(first.clearedSnapshots, 1);
  assert.equal(f.state.files[0].deletedAt?.toISOString(), now.toISOString());
  assert.equal(f.state.files[1].deletedAt, null);
  assert.equal(f.state.violations[0].violationType, "tab_switch");
  assert.equal(f.state.violations[0].screenshotPath, null);
  assert.ok(f.state.violations[1].screenshotPath);
  const second = await f.maintenance.runMaintenance(now);
  assert.equal(second.queuedEvidenceFiles, 0);
  assert.equal(second.removedEvidenceFiles, 0);
  assert.deepEqual(f.state.deleted, ["evidence/quiz/1.webm"]);
});

test("storage failure keeps a durable pending row and the next maintenance run retries", async () => {
  const f = fixture([file(1, "teacher-a")], [violation("teacher-a")]);
  f.failStorage(true);
  await assert.rejects(f.maintenance.runMaintenance(now), /S3 unavailable/);
  assert.ok(f.state.files[0].deletionRequestedAt);
  assert.equal(f.state.files[0].deletedAt, null);
  assert.ok(f.state.objects.has(f.state.files[0].filePath));
  f.failStorage(false);
  const retry = await f.maintenance.runMaintenance(now);
  assert.equal(retry.queuedEvidenceFiles, 0);
  assert.equal(retry.removedEvidenceFiles, 1);
});

test("database transaction failure never deletes external evidence", async () => {
  const f = fixture([file(1, "teacher-a")], [violation("teacher-a")]);
  f.failTransaction(true);
  await assert.rejects(f.maintenance.runMaintenance(now), /database transaction failed/);
  assert.equal(f.state.files[0].deletionRequestedAt, null);
  assert.equal(f.state.violations[0].screenshotPath !== null, true);
  assert.equal(f.state.objects.size, 1);
  assert.equal(f.state.deleted.length, 0);
});

test("database finalization failure leaves the pending row retryable after object removal", async () => {
  const f = fixture([file(1, "teacher-a")], [violation("teacher-a")]);
  f.failFinalize(true);
  await assert.rejects(f.maintenance.runMaintenance(now), /database finalize failed/);
  assert.ok(f.state.files[0].deletionRequestedAt);
  assert.equal(f.state.files[0].deletedAt, null);
  assert.equal(f.state.objects.size, 0);
  f.failFinalize(false);
  const retry = await f.maintenance.runMaintenance(now);
  assert.equal(retry.removedEvidenceFiles, 1);
  assert.ok(f.state.files[0].deletedAt);
  assert.equal(f.state.violations.length, 1);
});

test("missing S3 object is idempotent and does not block cleanup", async () => {
  const f = fixture([file(1, "teacher-a")], [violation("teacher-a")]);
  f.state.objects.clear();
  const result = await f.maintenance.runMaintenance(now);
  assert.equal(result.removedEvidenceFiles, 1);
  assert.ok(f.state.files[0].deletedAt);
});

test("maintenance drains a bounded backlog over repeated runs", async () => {
  const f = fixture(Array.from({ length: 21 }, (_, index) => file(index + 1, "teacher-a")), [violation("teacher-a")]);
  const first = await f.maintenance.runMaintenance(now);
  assert.equal(first.queuedEvidenceFiles, 21);
  assert.equal(first.removedEvidenceFiles, 20);
  assert.equal(f.state.files.filter((item) => item.deletedAt === null).length, 1);
  const second = await f.maintenance.runMaintenance(now);
  assert.equal(second.queuedEvidenceFiles, 0);
  assert.equal(second.removedEvidenceFiles, 1);
});

test("S3 deletion treats a missing object as success but surfaces storage failures", async () => {
  let failureName = "NoSuchKey";
  const deletedKeys: string[] = [];
  class DeleteObjectCommand {
    input: { Key: string };
    constructor(input: { Key: string }) { this.input = input; }
  }
  class S3Client {
    async send(command: DeleteObjectCommand) {
      deletedKeys.push(command.input.Key);
      const error = new Error(failureName);
      error.name = failureName;
      throw error;
    }
  }
  const storage = loadModule("src/lib/evidence-storage.ts", {
    "node:crypto": crypto,
    "node:fs/promises": fs.promises,
    "node:path": path,
    "@aws-sdk/client-s3": { DeleteObjectCommand, S3Client },
  }, {
    process: { cwd: () => process.cwd(), env: {
      NODE_ENV: "production", S3_ENDPOINT: "https://s3.example", S3_BUCKET: "private-evidence",
      S3_ACCESS_KEY: "test", S3_SECRET_KEY: "test",
    } },
  });
  await storage.deleteEvidence(["evidence/quiz/missing.webm"]);
  failureName = "ServiceUnavailable";
  await assert.rejects(storage.deleteEvidence(["evidence/quiz/pending.webm"]), /ServiceUnavailable/);
  assert.deepEqual(deletedKeys, ["evidence/quiz/missing.webm", "evidence/quiz/pending.webm"]);
});

test("Teacher endpoint requires a Teacher session and passes only the authenticated owner", async () => {
  const calls: string[] = [];
  let role = "student";
  let retentionConflict = false;
  class RetentionError extends Error { retentionDays = 90; }
  const route = loadModule("src/app/api/dashboard/teacher/evidence/route.ts", {
    "next/server": { NextResponse: { json: (body: unknown, options: { status?: number } = {}) =>
      new Response(JSON.stringify(body), { status: options.status ?? 200 }) } },
    "@/lib/prisma": { default: {} },
    "@/lib/auth": { getSession: async () => ({ role, userId: "teacher-a" }) },
    "@/lib/maintenance": { expireSubscriptions: async () => {} },
    "@/lib/teacher-entitlements": { hasActiveProSubscription: async () => true },
    "@/lib/proctoring-detection": { getViolationLabel: () => "Violation" },
    "@/lib/evidence-retention": {
      EvidenceWithinRetentionError: RetentionError,
      requestTeacherEvidencePurge: async (owner: string) => {
        calls.push(owner);
        if (retentionConflict) throw new RetentionError("Evidence newer than 90 days cannot be purged");
        return { retentionDays: 90, queuedEvidenceFiles: 1, clearedSnapshots: 0 };
      },
    },
  });
  assert.equal((await route.DELETE()).status, 401);
  role = "teacher";
  assert.equal((await route.DELETE()).status, 202);
  retentionConflict = true;
  const protectedResponse = await route.DELETE();
  assert.equal(protectedResponse.status, 409);
  assert.equal((await protectedResponse.json()).code, "EVIDENCE_RETENTION_ACTIVE");
  assert.deepEqual(calls, ["teacher-a", "teacher-a"]);
});
