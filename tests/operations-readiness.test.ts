import assert from "node:assert/strict";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { backupFreshness, validateBackupConfig, validateBackupStatusConfig } from "../scripts/backup-config.mjs";
import { decryptFileToPath, encryptToFile } from "../scripts/backup-crypto.mjs";

function loadRoute(relativePath: string, dependencies: Record<string, unknown>, environment: Record<string, string> = {}, logs: string[] = []) {
  const filename = path.resolve(process.cwd(), relativePath);
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const sandboxModule = { exports: {} as Record<string, any> };
  vm.runInNewContext(code, {
    module: sandboxModule, exports: sandboxModule.exports, Response, Headers, Buffer,
    process: { env: environment },
    console: { info: (...args: unknown[]) => logs.push(JSON.stringify(args)), error: (...args: unknown[]) => logs.push(JSON.stringify(args)) },
    require: (name: string) => {
      if (name in dependencies) return dependencies[name];
      throw new Error(`Unexpected dependency: ${name}`);
    },
  }, { filename });
  return sandboxModule.exports;
}

const nextServer = { NextResponse: { json: (body: unknown, options: { status?: number; headers?: Record<string, string> } = {}) =>
  new Response(JSON.stringify(body), { status: options.status ?? 200, headers: options.headers }) } };

test("maintenance requires the server-only bearer and exposes a protected status", async () => {
  const secret = "s".repeat(48);
  const environment = { CRON_SECRET: secret, NEXT_PUBLIC_CRON_SECRET: secret };
  let runs = 0;
  const route = loadRoute("src/app/api/internal/maintenance/route.ts", {
    "node:crypto": crypto,
    "next/server": nextServer,
    "@/lib/maintenance": {
      runMaintenance: async () => { runs++; return { removedEvidenceFiles: 1 }; },
      getMaintenanceStatus: async () => ({ status: "ok", pendingEvidenceFiles: 0, stale: false }),
    },
  }, environment);
  const request = (bearer?: string) => ({ headers: new Headers(bearer ? { authorization: `Bearer ${bearer}` } : {}) });
  assert.equal((await route.POST(request())).status, 401);
  assert.equal((await route.GET(request())).status, 401);
  assert.equal((await route.POST(request("wrong"))).status, 401);
  assert.equal(runs, 0);
  const completed = await route.POST(request(secret));
  assert.equal(completed.status, 200);
  assert.equal(runs, 1);
  const status = await route.GET(request(secret));
  assert.equal(status.status, 200);
  assert.equal(status.headers.get("cache-control"), "no-store");
  delete (environment as Partial<typeof environment>).CRON_SECRET;
  assert.equal((await route.POST(request(secret))).status, 503);
  assert.equal(runs, 1);
});

test("maintenance failures and status alerts are visible without leaking errors", async () => {
  const logs: string[] = [];
  const secret = "x".repeat(40);
  const route = loadRoute("src/app/api/internal/maintenance/route.ts", {
    "node:crypto": crypto,
    "next/server": nextServer,
    "@/lib/maintenance": {
      runMaintenance: async () => { throw new Error("private-storage-key"); },
      getMaintenanceStatus: async () => ({ status: "attention", pendingEvidenceFiles: 100, stale: true }),
    },
  }, { CRON_SECRET: secret }, logs);
  const request = { headers: new Headers({ authorization: `Bearer ${secret}` }) };
  assert.equal((await route.POST(request)).status, 500);
  assert.equal((await route.GET(request)).status, 503);
  assert.doesNotMatch(logs.join(" "), /private-storage-key|x{40}/);
});

test("health returns generic status and logs only the failed dependency", async () => {
  const logs: string[] = [];
  const route = loadRoute("src/app/api/health/route.ts", {
    "next/server": nextServer,
    "@/lib/prisma": { __esModule: true, default: { $queryRaw: async () => { throw new Error("postgresql://user:private-password@host/db"); } } },
    "@/lib/redis": { getRedis: () => ({ ping: async () => "PONG" }) },
    "@/lib/evidence-storage": { checkEvidenceStorage: async () => true },
  }, {}, logs);
  const response = await route.GET();
  assert.equal(response.status, 503);
  assert.equal(await response.text(), '{"status":"unavailable"}');
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(logs.join(" "), /postgresql/);
  assert.doesNotMatch(logs.join(" "), /private-password/);
});

function validBackupEnvironment() {
  return {
    BACKUP_TARGET_ENV: "production", RAILWAY_ENVIRONMENT_NAME: "production",
    RAILWAY_PROJECT_ID: "cccccccc-cccc-4ccc-cccc-cccccccccccc",
    BACKUP_APPROVED_PROJECT_ID: "cccccccc-cccc-4ccc-cccc-cccccccccccc",
    RAILWAY_ENVIRONMENT_ID: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
    BACKUP_APPROVED_ENVIRONMENT_ID: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
    BACKUP_APP_COMMIT: "a".repeat(40),
    DATABASE_URL: "postgresql://backup:secret@db.prod.example:5432/proctorshield?sslmode=require",
    BACKUP_APPROVED_DATABASE_HOST: "db.prod.example", BACKUP_APPROVED_DATABASE_NAME: "proctorshield",
    S3_ENDPOINT: "https://live-objects.example", S3_BUCKET: "live-evidence", S3_ACCESS_KEY: "source-key", S3_SECRET_KEY: "source-secret",
    BACKUP_DESTINATION_ENDPOINT: "https://offsite.example", BACKUP_DESTINATION_BUCKET: "backup-sets",
    BACKUP_DESTINATION_ACCESS_KEY: "destination-key", BACKUP_DESTINATION_SECRET_KEY: "destination-secret",
    BACKUP_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    BACKUP_WRITES_PAUSED: "true", BACKUP_MAINTENANCE_PAUSED: "true",
  };
}

test("offsite backup guards reject environment crossover and same-provider destinations", () => {
  const valid = validBackupEnvironment();
  assert.equal(validateBackupConfig(valid).database.hostname, "db.prod.example");
  for (const change of [
    { BACKUP_TARGET_ENV: "staging" },
    { RAILWAY_ENVIRONMENT_NAME: "staging" },
    { RAILWAY_PROJECT_ID: "another-project" },
    { RAILWAY_ENVIRONMENT_ID: "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb" },
    { BACKUP_APPROVED_DATABASE_NAME: "demo" },
    { DATABASE_URL: "postgresql://backup:secret@normal.example:5432/proctorshield" },
    { BACKUP_WRITES_PAUSED: "false" },
    { BACKUP_APP_COMMIT: "unknown" },
    { BACKUP_DESTINATION_ENDPOINT: "https://live-objects.example" },
    { BACKUP_DESTINATION_ACCESS_KEY: "source-key" },
    { BACKUP_ENCRYPTION_KEY: "invalid" },
  ]) {
    assert.throws(() => validateBackupConfig({ ...valid, ...change }));
  }
});

test("backup freshness flags missing jobs and overdue restore drills", () => {
  const now = new Date("2026-09-30T12:00:00Z");
  assert.deepEqual(backupFreshness(null, null, now), { backupFresh: false, restoreCurrent: false });
  assert.deepEqual(backupFreshness({ completedAt: "2026-09-29T12:00:00Z" }, { verifiedAt: "2026-09-01T12:00:00Z" }, now),
    { backupFresh: true, restoreCurrent: true });
  assert.deepEqual(backupFreshness({ completedAt: "2026-09-28T12:00:00Z" }, { verifiedAt: "2026-08-01T12:00:00Z" }, now),
    { backupFresh: false, restoreCurrent: false });
});

test("backup freshness checker needs only read access to the separate destination", () => {
  const env = validBackupEnvironment();
  delete (env as Partial<typeof env>).DATABASE_URL;
  delete (env as Partial<typeof env>).S3_SECRET_KEY;
  delete (env as Partial<typeof env>).BACKUP_ENCRYPTION_KEY;
  const config = validateBackupStatusConfig(env);
  assert.equal(config.destination.bucket, "backup-sets");
  assert.equal("encryptionKey" in config, false);
});

test("backup encryption round-trips and rejects altered ciphertext", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "psai-ops-crypto-"));
  const encrypted = path.join(directory, "set.bin");
  const restored = path.join(directory, "restored.bin");
  const altered = path.join(directory, "altered.bin");
  const key = crypto.randomBytes(32);
  const source = Buffer.from("private evidence and database test bytes");
  try {
    const metadata = await encryptToFile(Readable.from([source]), encrypted, key);
    assert.equal(metadata.plainSha256, crypto.createHash("sha256").update(source).digest("hex"));
    await decryptFileToPath(encrypted, restored, key, metadata.plainSha256, metadata.plainBytes);
    assert.deepEqual(fs.readFileSync(restored), source);
    const damaged = fs.readFileSync(encrypted);
    damaged[13] ^= 0x01;
    fs.writeFileSync(encrypted, damaged);
    await assert.rejects(decryptFileToPath(encrypted, altered, key));
    const emptyEncrypted = path.join(directory, "empty.bin");
    const emptyRestored = path.join(directory, "empty-restored.bin");
    const empty = await encryptToFile(Readable.from([]), emptyEncrypted, key);
    assert.equal(empty.plainBytes, 0);
    await decryptFileToPath(emptyEncrypted, emptyRestored, key, empty.plainSha256, 0);
    assert.equal(fs.statSync(emptyRestored).size, 0);
  } finally {
    if (directory.startsWith(os.tmpdir() + path.sep)) fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("restore helper refuses execution inside a live Railway environment", () => {
  const setId = "2026-09-30T01-00-00-000Z-aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
  const result = spawnSync(process.execPath, ["scripts/backup-restore.mjs", "--verify-only", setId], {
    cwd: process.cwd(), encoding: "utf8",
    env: { ...process.env, RESTORE_TARGET_ENV: "isolated", RAILWAY_ENVIRONMENT_ID: "production-id",
      RAILWAY_ENVIRONMENT_NAME: "production" },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Recovery verification failed at configuration/);
});

test("cron runner rejects a mismatched environment without exposing its bearer", () => {
  const secret = "private-cron-token-" + "z".repeat(40);
  const result = spawnSync(process.execPath, ["scripts/maintenance-cron.mjs"], {
    cwd: process.cwd(), encoding: "utf8",
    env: { ...process.env, RAILWAY_ENVIRONMENT_ID: "staging-id", OPS_APPROVED_ENVIRONMENT_ID: "production-id",
      OPS_APP_ORIGIN: "https://app.example", OPS_APPROVED_APP_HOST: "app.example", CRON_SECRET: secret },
  });
  assert.equal(result.status, 1);
  assert.doesNotMatch(result.stdout + result.stderr, /private-cron-token|app\.example/);
});
