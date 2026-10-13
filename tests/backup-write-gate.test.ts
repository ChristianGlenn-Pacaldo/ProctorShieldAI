import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
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
  let failUpsertKey: string | null = null;
  const setting = {
    findUnique: async ({ where }: any) => {
      if (dbUnavailable) throw new Error("DB unavailable");
      const settingValue = rows.get(where.settingKey);
      return settingValue === undefined ? null : { settingValue };
    },
    create: async ({ data }: any) => { rows.set(data.settingKey, data.settingValue); },
    upsert: async ({ where, create, update }: any) => {
      rows.set(where.settingKey, rows.has(where.settingKey) ? update.settingValue : create.settingValue);
      if (where.settingKey === failUpsertKey) { failUpsertKey = null; throw new Error("Synthetic injected transaction failure"); }
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
      const snapshot = new Map(rows);
      try { return await callback({ setting, $queryRaw: async (query: TemplateStringsArray) => {
        assert.match(query.join(""), /pg_advisory_xact_lock\(20260930, 6\)::text/);
        return [{ locked: "" }];
      } }); }
      catch (error) { rows.clear(); for (const [k,v] of snapshot) rows.set(k,v); throw error; }
      finally { release(); }
    },
  };
  const reload = () => {
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
  return exports;
  };
  return { gate: reload(), reload, rows, env, setDbUnavailable: (value: boolean) => { dbUnavailable = value; }, failNextUpsert: (key: string) => { failUpsertKey = key; } };
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


const leaseHolders = new WeakMap<object, any>();
function acquisition(expectedGeneration: number, overrides: Record<string, unknown> = {}) {
  const releaseCapability = crypto.randomBytes(32).toString("hex");
  return { body: { contract: "owned-lease-v1", operationId: "psai-recovery-" + crypto.randomUUID(),
    owner: crypto.randomBytes(32).toString("hex"), expectedGeneration,
    releaseHash: crypto.createHash("sha256").update(releaseCapability).digest("hex"), ...overrides }, releaseCapability };
}
function releaseBody(held: any, overrides: Record<string, unknown> = {}) {
  return { contract: "owned-lease-v1", operationId: held.state.operationId, owner: held.state.owner,
    leaseId: held.state.leaseId, expectedGeneration: held.state.generation, releaseCapability: held.releaseCapability, ...overrides };
}
async function lease(gate: any, paused: boolean) {
  if (paused) {
    const a = acquisition((await gate.getBackupWriteGateStatus()).generation);
    const state = await gate.acquireBackupWriteLease(a.body); leaseHolders.set(gate, { ...a, state }); return state;
  }
  return gate.releaseBackupWriteLease(releaseBody(leaseHolders.get(gate)));
}
function controlRequest(method: string, body?: unknown, bearer = staging.BACKUP_WRITE_GATE_SECRET) {
  return new Request("http://127.0.0.1/api/internal/backup-write-gate", { method,
    headers: { authorization: "Bearer " + bearer, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
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
  const activation = await lease(gate, true);
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
  assert.equal((await lease(gate, false)).paused, false);
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
  assert.equal((await lease(gate, true)).safeForBackup, false);
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
  assert.equal((await lease(gate, true)).safeForBackup, false);
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
    await lease(gate, true);
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
  assert.equal((await lease(gate, true)).safeForBackup, false);
});

test("direct maintenance and incidental writes cannot bypass a paused gate", async () => {
  const { gate } = fixture();
  await lease(gate, true);
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
  await lease(gate, true);
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
  await lease(gate, true);
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
  const a = acquisition(0);
  const activated = await route.POST(controlRequest("POST", a.body));
  assert.equal(activated.status, 200);
  const state = await activated.json();
  const status = await route.GET(controlRequest("GET"));
  assert.equal(status.status, 200);
  assert.equal((await status.json()).safeForBackup, true);
  assert.equal((await route.DELETE(controlRequest("DELETE", releaseBody({ ...a, state })))).status, 200);
  assert.equal((await gate.getBackupWriteGateStatus()).paused, false);
});

test("production identity cannot expose or activate the staging control endpoint", async () => {
  const { gate } = fixture({ ...staging, RAILWAY_ENVIRONMENT_NAME: "production" });
  const route = loadRoute("src/app/api/internal/backup-write-gate/route.ts", gate);
  const request = { headers: { get: () => `Bearer ${staging.BACKUP_WRITE_GATE_SECRET}` } };
  assert.equal((await route.POST(request)).status, 404);
  assert.equal((await route.GET(request)).status, 404);
});

test("owned acquisition persists exact identity and hides release authority", async () => {
  const { gate, rows } = fixture();
  const a = acquisition(0), state = await gate.acquireBackupWriteLease(a.body);
  assert.equal(state.contract, "owned-lease-v1");
  assert.equal(state.releaseProof, "sha256-capability-v1");
  assert.equal(state.owner, a.body.owner); assert.equal(state.operationId, a.body.operationId);
  assert.equal(state.generation, 1); assert.equal(state.paused, true); assert.equal(state.safeForBackup, true);
  assert.match(state.leaseId, /^[0-9a-f-]{36}$/);
  assert.equal(rows.get("backup_write_gate:paused"), "paused");
  assert.equal(JSON.stringify(state).includes(a.releaseCapability), false);
  assert.equal(JSON.stringify(state).includes(a.body.releaseHash), false);
});

test("generation exhaustion and invalid input never wrap or reset ownership", async () => {
  const {gate,rows}=fixture();
  rows.set("backup_write_gate:paused","open");
  rows.set("backup_write_gate:owned_lease_v1",JSON.stringify({schema:1,generation:Number.MAX_SAFE_INTEGER-1,paused:false,owner:null,operationId:null,leaseId:null,releaseHash:null}));
  const before=[...rows];
  await assert.rejects(gate.acquireBackupWriteLease(acquisition(Number.MAX_SAFE_INTEGER-1).body),{code:"GATE_GENERATION_EXHAUSTED",status:503});
  for(const expectedGeneration of [-1,1.5,Number.MAX_SAFE_INTEGER+1,"1"]){
    await assert.rejects(gate.acquireBackupWriteLease(acquisition(0,{expectedGeneration}).body),{code:"GATE_BODY",status:400});
  }
  assert.deepEqual([...rows],before);
});

test("competing mock acquisitions admit exactly one under the existing serialization lock", async () => {
  const { gate } = fixture(); const a = acquisition(0), b = acquisition(0);
  const results = await Promise.allSettled([gate.acquireBackupWriteLease(a.body), gate.acquireBackupWriteLease(b.body)]);
  assert.equal(results.filter(x => x.status === "fulfilled").length, 1);
  const rejected = results.find(x => x.status === "rejected") as PromiseRejectedResult;
  assert.equal(rejected.reason.code, "GATE_ALREADY_PAUSED");
  assert.equal((await gate.getBackupWriteGateStatus()).generation, 1);
  await assert.rejects(gate.acquireBackupWriteLease(a.body), { code: "GATE_ALREADY_PAUSED" });
});

test("each owner, operation, lease, generation and supervisor proof check independently rejects release", async t => {
  const { gate, rows } = fixture(); const a = acquisition(0), state = await gate.acquireBackupWriteLease(a.body);
  const held = { ...a, state }, before = JSON.stringify([...rows]);
  for (const [name, override, code] of [
    ["owner", { owner: "f".repeat(64) }, "GATE_LEASE_CONFLICT"],
    ["operation", { operationId: "psai-recovery-" + crypto.randomUUID() }, "GATE_LEASE_CONFLICT"],
    ["lease", { leaseId: crypto.randomUUID() }, "GATE_LEASE_CONFLICT"],
    ["generation", { expectedGeneration: 0 }, "GATE_LEASE_CONFLICT"],
    ["proof", { releaseCapability: "0".repeat(64) }, "GATE_RELEASE_PROOF"],
  ] as const) {
    await t.test(name, async () => {
      await assert.rejects(gate.releaseBackupWriteLease(releaseBody(held, override)), { code });
      assert.equal(JSON.stringify([...rows]), before);
    });
  }
});

test("release increments generation and exact request replay cannot affect a newer lease", async () => {
  const { gate } = fixture(); const a = acquisition(0), state = await gate.acquireBackupWriteLease(a.body);
  const request = releaseBody({ ...a, state });
  const opened = await gate.releaseBackupWriteLease(request);
  assert.equal(opened.paused, false); assert.equal(opened.generation, 2); assert.equal(opened.owner, null);
  await assert.rejects(gate.releaseBackupWriteLease(request), { code: "GATE_LEASE_CONFLICT" });
  await assert.rejects(gate.acquireBackupWriteLease(acquisition(0).body), { code: "GATE_GENERATION_CONFLICT" });
  const b = acquisition(2, { owner: a.body.owner }), newer = await gate.acquireBackupWriteLease(b.body);
  assert.equal(newer.generation, 3); assert.notEqual(newer.leaseId, state.leaseId);
  await assert.rejects(gate.releaseBackupWriteLease(request), { code: "GATE_LEASE_CONFLICT" });
  assert.equal((await gate.getBackupWriteGateStatus()).leaseId, newer.leaseId);
});

test("mock transaction rollback preserves both keys on failed acquire and failed release", async () => {
  const f = fixture(), a = acquisition(0);
  f.failNextUpsert("backup_write_gate:paused");
  await assert.rejects(f.gate.acquireBackupWriteLease(a.body), /Synthetic injected transaction failure/);
  assert.equal(f.rows.size, 0); assert.equal((await f.gate.getBackupWriteGateStatus()).generation, 0);
  const state = await f.gate.acquireBackupWriteLease(a.body), before = JSON.stringify([...f.rows]);
  f.failNextUpsert("backup_write_gate:paused");
  await assert.rejects(f.gate.releaseBackupWriteLease(releaseBody({ ...a, state })), /Synthetic injected transaction failure/);
  assert.equal(JSON.stringify([...f.rows]), before); assert.equal((await f.gate.getBackupWriteGateStatus()).paused, true);
});

test("mock application restart retains ownership, generation and pending mutation markers", async () => {
  const f = fixture(), a = acquisition(0), state = await f.gate.acquireBackupWriteLease(a.body);
  f.rows.set("backup_write_gate:active:synthetic-interrupted", "synthetic-marker");
  const reloaded = f.reload(), status = await reloaded.getBackupWriteGateStatus();
  assert.equal(status.leaseId, state.leaseId); assert.equal(status.generation, state.generation);
  assert.equal(status.owner, state.owner); assert.equal(status.activeMutations, 1); assert.equal(status.safeForBackup, false);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal((await reloaded.getBackupWriteGateStatus()).paused, true);
  assert.equal(f.rows.has("backup_write_gate:active:synthetic-interrupted"), true);
});

test("legacy blind controls and unowned legacy pause cannot open or be adopted", async () => {
  const f = fixture();
  await assert.rejects(f.gate.setBackupWritePause(false), { code: "OWNED_LEASE_REQUIRED" });
  await assert.rejects(f.gate.setBackupWritePause(true), { code: "OWNED_LEASE_REQUIRED" });
  f.rows.set("backup_write_gate:paused", "paused");
  const status = await f.gate.getBackupWriteGateStatus();
  assert.equal(status.paused, true); assert.equal(status.legacyPaused, true); assert.equal(status.safeForBackup, false);
  await assert.rejects(f.gate.acquireBackupWriteLease(acquisition(0).body), { code: "GATE_ALREADY_PAUSED" });
  assert.equal((await f.gate.withBackupWriteGate(async () => Response.json({ ok: true }))()).status, 503);
});

test("malformed or inconsistent persistent ownership fails closed for admission and incidental work", async t => {
  for (const kind of ["invalid-json", "invalid-pause", "mismatch", "missing-pause"]) {
    await t.test(kind, async () => {
      const f = fixture(); await lease(f.gate, true);
      if (kind === "invalid-json") f.rows.set("backup_write_gate:owned_lease_v1", "invalid");
      if (kind === "invalid-pause") f.rows.set("backup_write_gate:paused", "unexpected");
      if (kind === "mismatch") f.rows.set("backup_write_gate:paused", "open");
      if (kind === "missing-pause") f.rows.delete("backup_write_gate:paused");
      let writes = 0;
      assert.equal((await f.gate.withBackupWriteGate(async () => { writes++; return Response.json({}); })()).status, 503);
      assert.equal(await f.gate.runIncidentalBackupWrite(async () => { writes++; return 1; }, 0), 0);
      await assert.rejects(f.gate.getBackupWriteGateStatus()); assert.equal(writes, 0);
    });
  }
});

test("API rejects bodyless legacy requests, malformed and oversized JSON without changing state", async () => {
  const f = fixture(), route = loadRoute("src/app/api/internal/backup-write-gate/route.ts", f.gate);
  assert.equal((await route.POST(controlRequest("POST"))).status, 400);
  assert.equal((await route.DELETE(controlRequest("DELETE"))).status, 400);
  assert.equal((await route.POST(controlRequest("POST", { ...acquisition(0).body, unexpected: true }))).status, 400);
  assert.equal((await route.POST(controlRequest("POST", { padding: "x".repeat(3000) }))).status, 413);
  const bad = new Request("http://127.0.0.1/api/internal/backup-write-gate", { method: "POST", headers: {
    authorization: "Bearer " + staging.BACKUP_WRITE_GATE_SECRET, "content-type": "application/json" }, body: "{" });
  assert.equal((await route.POST(bad)).status, 400); assert.equal(f.rows.size, 0);
});

test("API bearer alone cannot release even after copying all public owner fields", async () => {
  const f = fixture(), route = loadRoute("src/app/api/internal/backup-write-gate/route.ts", f.gate), a = acquisition(0);
  const activated = await route.POST(controlRequest("POST", a.body)), state = await activated.json();
  const wrong = await route.DELETE(controlRequest("DELETE", releaseBody({ ...a, state }, { releaseCapability: "a".repeat(64) })));
  assert.equal(wrong.status, 403); assert.equal((await f.gate.getBackupWriteGateStatus()).paused, true);
  assert.equal((await route.DELETE(controlRequest("DELETE", releaseBody({ ...a, state })))).status, 200);
  assert.equal((await route.GET(controlRequest("GET"))).headers.get("cache-control"), "no-store");
});

async function actualRouteFixture(t: any) {
  const f = fixture(), route = loadRoute("src/app/api/internal/backup-write-gate/route.ts", f.gate);
  let deleteCalls = 0;
  const server = http.createServer(async (incoming, outgoing) => {
    const chunks: Buffer[] = []; for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
    const method = incoming.method || "GET";
    const headers = new Headers(); for (const [key,value] of Object.entries(incoming.headers)) if (typeof value === "string") headers.set(key,value);
    // Translate only the synthetic fixture's bearer; never use any real configuration.
    if (headers.get("authorization") === "Bearer synthetic-gate-token") headers.set("authorization", "Bearer " + staging.BACKUP_WRITE_GATE_SECRET);
    const request = new Request("http://127.0.0.1/api/internal/backup-write-gate", { method, headers,
      ...(method === "GET" ? {} : { body: Buffer.concat(chunks) }) });
    if (method === "DELETE") deleteCalls++;
    const result = await route[method](request); outgoing.writeHead(result.status, Object.fromEntries(result.headers)); outgoing.end(await result.text());
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  return { ...f, endpoint: "http://127.0.0.1:" + (server.address() as any).port, getDeleteCalls: () => deleteCalls };
}

test("real gate route and library interoperate with tooling over synthetic loopback only", async t => {
  const g = await actualRouteFixture(t), { fixture: recoveryFixture } = await import("../tooling/recovery-v1/tests/fixtures.mjs");
  const { loadOperation } = await import("../tooling/recovery-v1/lib/security.mjs");
  const { pause, drain, owned, release } = await import("../tooling/recovery-v1/lib/gate.mjs");
  const f = await recoveryFixture(t, { gate: { endpoint: g.endpoint, contract: "owned-lease-v1" } }), c = await loadOperation(f.paths, "gate");
  const acquired = await pause(c); assert.equal(acquired.generation, 1);
  assert.equal((await drain(c)).safeForBackup, true); assert.equal((await owned(c)).leaseId, acquired.leaseId);
  await fs.promises.unlink(path.join(f.paths.secrets, "gate-release-capability"));
  assert.equal((await owned(c)).paused, true);
  await assert.rejects(release(c), { code: "ENOENT" }); assert.equal(g.getDeleteCalls(), 0);
  await fs.promises.writeFile(path.join(f.paths.secrets, "gate-release-capability"), f.secrets["gate-release-capability"], { mode: 0o600 });
  assert.equal((await release(c)).released, true); assert.equal(g.getDeleteCalls(), 1);
});

test("old pinned tooling receipt cannot release a newer lease even with the same owner", async t => {
  const g = await actualRouteFixture(t), { fixture: recoveryFixture } = await import("../tooling/recovery-v1/tests/fixtures.mjs");
  const { loadOperation } = await import("../tooling/recovery-v1/lib/security.mjs");
  const { pause, release, owned } = await import("../tooling/recovery-v1/lib/gate.mjs");
  const f = await recoveryFixture(t, { gate: { endpoint: g.endpoint, contract: "owned-lease-v1" } }), c = await loadOperation(f.paths, "gate");
  const first = await pause(c); await release(c);
  const a = acquisition(2, { owner: first.owner, operationId: first.operationId });
  const newer = await g.gate.acquireBackupWriteLease(a.body);
  const deletes = g.getDeleteCalls(); await assert.rejects(release(c), { code: "GATE_LEASE_CHANGED" });
  await assert.rejects(owned(c), { code: "GATE_LEASE_CHANGED" });
  assert.equal(g.getDeleteCalls(), deletes); assert.equal((await g.gate.getBackupWriteGateStatus()).leaseId, newer.leaseId);
});
