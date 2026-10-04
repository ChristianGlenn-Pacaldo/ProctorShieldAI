import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const staging = {
  BACKUP_WRITE_GATE_STAGING_TEST: "true",
  BACKUP_WRITE_GATE_SECRET: "s".repeat(40),
  CRON_SECRET: "c".repeat(40),
  RAILWAY_ENVIRONMENT_NAME: "staging",
  RAILWAY_PROJECT_ID: "8007b266-c02c-4c99-ba85-a210b7b3f777",
  RAILWAY_ENVIRONMENT_ID: "0a5835a6-ea32-44f5-848f-63e4536da240",
  RAILWAY_SERVICE_ID: "5bdc84f0-91cb-4328-b04c-d67b0d6eb133",
};

function compile(file: string) {
  return ts.transpileModule(fs.readFileSync(path.resolve(file), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
}

function fixture(env: Record<string, string> = { ...staging }) {
  const rows = new Map<string, string>();
  let tail = Promise.resolve();
  let dbUnavailable = false;
  const setting = {
    findUnique: async ({ where }: any) => {
      if (dbUnavailable) throw new Error("DB unavailable");
      const settingValue = rows.get(where.settingKey);
      return settingValue === undefined ? null : { settingValue };
    },
    create: async ({ data }: any) => { rows.set(data.settingKey, data.settingValue); },
    upsert: async ({ where, create, update }: any) => {
      rows.set(where.settingKey, rows.has(where.settingKey) ? update.settingValue : create.settingValue);
    },
    count: async ({ where }: any) => [...rows.keys()].filter((key) => key.startsWith(where.settingKey.startsWith)).length,
    deleteMany: async ({ where }: any) => { rows.delete(where.settingKey); },
  };
  const prisma = {
    setting,
    $transaction: async (callback: (tx: any) => Promise<unknown>) => {
      const previous = tail;
      let release!: () => void;
      tail = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      try { return await callback({ setting, $queryRaw: async (query: TemplateStringsArray) => {
        assert.match(query.join(""), /pg_advisory_xact_lock\(20260930, 6\)::text/);
        return [{ locked: "" }];
      } }); }
      finally { release(); }
    },
  };
  const exports: Record<string, any> = {};
  vm.runInNewContext(compile("src/lib/backup-write-gate.ts"), {
    exports, Buffer, Response, Date, console, process: { env },
    require: (name: string) => {
      if (name === "server-only") return {};
      if (name === "node:crypto") return { __esModule: true, default: crypto };
      if (name === "./prisma") return { __esModule: true, default: prisma };
      throw new Error(`Unexpected dependency ${name}`);
    },
  });
  return { gate: exports, rows, env, setDbUnavailable: (value: boolean) => { dbUnavailable = value; } };
}

function loadRoute(file: string, gate: Record<string, any>, dependencies: Record<string, unknown> = {}) {
  const exports: Record<string, any> = {};
  vm.runInNewContext(compile(file), {
    exports, Response, Buffer, process: { env: staging }, console,
    require: (name: string) => {
      if (name === "@/lib/backup-write-gate") return gate;
      if (name === "next/server") return { NextResponse: { json: (body: unknown, options: ResponseInit = {}) => Response.json(body, options) } };
      if (name === "node:crypto") return { __esModule: true, default: crypto };
      if (name in dependencies) return dependencies[name];
      return {};
    },
  });
  return exports;
}

test("disabled and production configurations leave ordinary writes unchanged", async () => {
  for (const env of [{}, { ...staging, RAILWAY_ENVIRONMENT_NAME: "production" }]) {
    const { gate, rows } = fixture(env);
    let writes = 0;
    const handler = gate.withBackupWriteGate(async () => { writes++; return Response.json({ success: true }); });
    assert.equal((await handler()).status, 200);
    assert.equal(writes, 1);
    assert.equal(rows.size, 0);
    assert.equal(gate.stagingWriteGateConfigured(), false);
  }
});

test("activation blocks new mutations, counts in-flight work, drains, and reverses", async () => {
  const { gate } = fixture();
  let started!: () => void;
  let finish!: () => void;
  const entered = new Promise<void>((resolve) => { started = resolve; });
  const pending = new Promise<void>((resolve) => { finish = resolve; });
  let writes = 0;
  const handler = gate.withBackupWriteGate(async () => { writes++; started(); await pending; return Response.json({ success: true }); });
  const first = handler();
  await entered;
  const activation = await gate.setBackupWritePause(true);
  assert.equal(activation.paused, true);
  assert.equal(activation.activeMutations, 1);
  assert.equal(activation.safeForBackup, false);
  const rejected = await handler();
  assert.equal(rejected.status, 503);
  assert.equal(rejected.headers.get("Retry-After"), "30");
  assert.equal(writes, 1);
  finish();
  assert.equal((await first).status, 200);
  assert.equal((await gate.getBackupWriteGateStatus()).safeForBackup, true);
  assert.equal((await gate.setBackupWritePause(false)).paused, false);
  assert.equal((await handler()).status, 200);
  assert.equal(writes, 2);
});

test("deferred auth writes retain a durable marker until after() completes", async () => {
  const { gate } = fixture();
  let scheduled!: () => Promise<void>;
  let writes = 0;
  const request = gate.withBackupWriteGate(async () => {
    await gate.scheduleTrackedBackupWork(
      (work: () => Promise<void>) => { scheduled = work; },
      async () => { writes++; },
    );
    return Response.json({ success: true });
  });
  assert.equal((await request()).status, 200);
  assert.equal((await gate.setBackupWritePause(true)).safeForBackup, false);
  assert.equal(writes, 0);
  await scheduled();
  assert.equal(writes, 1);
  assert.equal((await gate.getBackupWriteGateStatus()).safeForBackup, true);
});

test("delayed Arena resolution remains counted throughout its wait", async () => {
  const { gate } = fixture();
  let scheduled!: () => Promise<void>;
  let releaseWait!: () => void;
  const pending = new Promise<void>((resolve) => { releaseWait = resolve; });
  await gate.scheduleTrackedBackupWork(
    (work: () => Promise<void>) => { scheduled = work; },
    async () => { await pending; },
  );
  const inFlight = scheduled();
  assert.equal((await gate.setBackupWritePause(true)).safeForBackup, false);
  releaseWait();
  await inFlight;
  assert.equal((await gate.getBackupWriteGateStatus()).safeForBackup, true);
  assert.match(fs.readFileSync(path.resolve("src/app/api/arena/battle-action/route.ts"), "utf8"), /scheduleTrackedBackupWork/);
});

test("already admitted auth work completes inline if pause wins deferred admission", async () => {
  const { gate } = fixture();
  let writes = 0;
  let scheduled = false;
  const request = gate.withBackupWriteGate(async () => {
    await gate.setBackupWritePause(true);
    await gate.scheduleTrackedBackupWork(
      () => { scheduled = true; },
      async () => { writes++; },
    );
    return Response.json({ success: true });
  });
  assert.equal((await request()).status, 200);
  assert.equal(scheduled, false);
  assert.equal(writes, 1);
  assert.equal((await gate.getBackupWriteGateStatus()).safeForBackup, true);
});

test("admission failure fails closed and a missing release cannot report a drained gate", async () => {
  const { gate, rows, setDbUnavailable } = fixture();
  let writes = 0;
  const handler = gate.withBackupWriteGate(async () => { writes++; return Response.json({ success: true }); });
  setDbUnavailable(true);
  assert.equal((await handler()).status, 503);
  assert.equal(writes, 0);
  setDbUnavailable(false);
  rows.set("backup_write_gate:active:stale", new Date().toISOString());
  assert.equal((await gate.setBackupWritePause(true)).safeForBackup, false);
});

test("direct maintenance and incidental writes cannot bypass a paused gate", async () => {
  const { gate } = fixture();
  await gate.setBackupWritePause(true);
  let writes = 0;
  await assert.rejects(gate.runBackupWriteOrReject(async () => { writes++; }), /paused or unavailable/);
  const result = await gate.runIncidentalBackupWrite(async () => { writes++; return 1; }, 0);
  assert.equal(result, 0);
  assert.equal(writes, 0);
  assert.equal((await gate.getBackupWriteGateStatus()).safeForBackup, true);
});

test("all unsafe API handlers use the gate; health and status GET remain available", () => {
  const root = path.resolve("src/app/api");
  const walk = (folder: string): string[] => fs.readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(folder, entry.name);
    return entry.isDirectory() ? walk(full) : entry.name === "route.ts" ? [full] : [];
  });
  let guarded = 0;
  for (const file of walk(root)) {
    const source = fs.readFileSync(file, "utf8");
    if (file.endsWith(path.join("internal", "backup-write-gate", "route.ts"))) continue;
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      if (new RegExp(`async function ${method}Impl\\b`).test(source)) {
        if (method === "POST" && file.endsWith(path.join("auth", "logout", "route.ts"))) {
          // Logout deliberately keeps generation invalidation outside admission;
          // all DB revocation remains behind the real gate (behavior tested in
          // auth-phase1-blockers, including paused/unavailable admission).
          assert.match(source, /const revokeWithWriteGate = withBackupWriteGate\(POSTImpl\)/, file);
          assert.match(source, /response = await revokeWithWriteGate\(req, expected\)/, file);
          assert.doesNotMatch(source, /await clearSession\(response\)/, file);
          assert.match(source, /await invalidateBrowserAuthentication\(expected\)/, file);
          const outer = source.slice(source.indexOf("export async function POST("));
          assert.doesNotMatch(outer, /prisma\./, "logout outer invalidation cannot perform ungated DB writes");
        } else {
          assert.match(source, new RegExp(`export const ${method} = withBackupWriteGate\\(${method}Impl\\)`), file);
        }
        guarded++;
      } else {
        assert.doesNotMatch(source, new RegExp(`export async function ${method}\\b`), file);
      }
    }
  }
  assert.equal(guarded, 40);
  assert.doesNotMatch(fs.readFileSync(path.join(root, "health", "route.ts"), "utf8"), /withBackupWriteGate/);
  assert.match(fs.readFileSync(path.join(root, "internal", "maintenance", "route.ts"), "utf8"), /export const POST = withBackupWriteGate\(POSTImpl\)/);
});

test("maintenance, evidence upload, and PayMongo webhook reject before their handlers run", async () => {
  const { gate } = fixture();
  await gate.setBackupWritePause(true);
  let storageWrites = 0;
  let paymentTransactions = 0;
  for (const file of [
    "src/app/api/internal/maintenance/route.ts",
    "src/app/api/live/violation/route.ts",
    "src/app/api/live/violation/[id]/evidence/route.ts",
    "src/app/api/billing/webhook/route.ts",
  ]) {
    const route = loadRoute(file, gate, {
      "@/lib/proctoring-detection": { VALID_VIOLATION_TYPES: ["no_face"] },
      "@/lib/evidence-storage": { uploadEvidenceBytes: async () => { storageWrites++; } },
      "@/lib/prisma": { __esModule: true, default: { $transaction: async () => { paymentTransactions++; } } },
    });
    const response = await route.POST({ headers: { get: () => null } }, { params: Promise.resolve({ id: "1" }) });
    assert.equal(response.status, 503, file);
  }
  assert.equal(storageWrites, 0);
  assert.equal(paymentTransactions, 0);
  assert.equal((await gate.getBackupWriteGateStatus()).safeForBackup, true);
});

test("health and authenticated maintenance status remain readable during a pause", async () => {
  const { gate } = fixture();
  await gate.setBackupWritePause(true);
  const health = loadRoute("src/app/api/health/route.ts", gate, {
    "@/lib/prisma": { __esModule: true, default: { $queryRaw: async () => [1] } },
    "@/lib/redis": { getRedis: () => ({ ping: async () => "PONG" }) },
    "@/lib/evidence-storage": { checkEvidenceStorage: async () => true },
  });
  assert.equal((await health.GET()).status, 200);
  const maintenance = loadRoute("src/app/api/internal/maintenance/route.ts", gate, {
    "@/lib/maintenance": { getMaintenanceStatus: async () => ({ status: "ok", pendingEvidenceFiles: 0 }) },
  });
  const request = { headers: { get: () => `Bearer ${staging.CRON_SECRET}` } };
  assert.equal((await maintenance.GET(request)).status, 200);
  assert.equal((await gate.getBackupWriteGateStatus()).safeForBackup, true);
});

test("staging control requires server-only bearer and exposes a drain status", async () => {
  const { gate } = fixture();
  const route = loadRoute("src/app/api/internal/backup-write-gate/route.ts", gate);
  const wrong = { headers: { get: () => "Bearer wrong" } };
  assert.equal((await route.POST(wrong)).status, 401);
  const request = { headers: { get: () => `Bearer ${staging.BACKUP_WRITE_GATE_SECRET}` } };
  assert.equal((await route.POST(request)).status, 200);
  const status = await route.GET(request);
  assert.equal(status.status, 200);
  assert.equal((await status.json()).safeForBackup, true);
  assert.equal((await route.DELETE(request)).status, 200);
  assert.equal((await gate.getBackupWriteGateStatus()).paused, false);
});

test("production identity cannot expose or activate the staging control endpoint", async () => {
  const { gate } = fixture({ ...staging, RAILWAY_ENVIRONMENT_NAME: "production" });
  const route = loadRoute("src/app/api/internal/backup-write-gate/route.ts", gate);
  const request = { headers: { get: () => `Bearer ${staging.BACKUP_WRITE_GATE_SECRET}` } };
  assert.equal((await route.POST(request)).status, 404);
  assert.equal((await route.GET(request)).status, 404);
});
