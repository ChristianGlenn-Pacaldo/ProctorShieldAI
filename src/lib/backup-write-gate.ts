import "server-only";
import crypto from "node:crypto";
import type { Prisma } from "@prisma/client";
import prisma from "./prisma";

const PROJECT_ID = "8007b266-c02c-4c99-ba85-a210b7b3f777";
const ENVIRONMENT_ID = "0a5835a6-ea32-44f5-848f-63e4536da240";
const WEB_SERVICE_ID = "5bdc84f0-91cb-4328-b04c-d67b0d6eb133";
const PAUSE_KEY = "backup_write_gate:paused";
const ACTIVE_PREFIX = "backup_write_gate:active:";

export function stagingWriteGateConfigured(env: NodeJS.ProcessEnv = process.env) {
  return env.BACKUP_WRITE_GATE_STAGING_TEST === "true"
    && env.RAILWAY_ENVIRONMENT_NAME === "staging"
    && env.RAILWAY_PROJECT_ID === PROJECT_ID
    && env.RAILWAY_ENVIRONMENT_ID === ENVIRONMENT_ID
    && env.RAILWAY_SERVICE_ID === WEB_SERVICE_ID;
}

export function stagingWriteGateSecret(env: NodeJS.ProcessEnv = process.env) {
  const secret = env.BACKUP_WRITE_GATE_SECRET?.trim();
  return secret && Buffer.byteLength(secret) >= 32 ? secret : null;
}

export function validGateBearer(authorization: string | null, secret: string) {
  const supplied = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
  const actual = Buffer.from(supplied);
  const expected = Buffer.from(secret);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

async function serialized<T>(work: (tx: Prisma.TransactionClient) => Promise<T>) {
  return prisma.$transaction(async (tx) => {
    // Admission and activation must share this transaction lock. A request is
    // either counted before the pause or rejected after it; there is no gap.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(20260930, 6)::text AS locked`;
    return work(tx);
  });
}

async function enterMutation() {
  const token = crypto.randomUUID();
  const admitted = await serialized(async (tx) => {
    const { lease } = await readLease(tx);
    if (lease.paused) return false;
    await tx.setting.create({ data: { settingKey: `${ACTIVE_PREFIX}${token}`, settingValue: new Date().toISOString() } });
    return true;
  });
  return admitted ? token : null;
}

async function leaveMutation(token: string) {
  await prisma.setting.deleteMany({ where: { settingKey: `${ACTIVE_PREFIX}${token}` } });
}

async function releaseMutation(token: string) {
  try {
    await leaveMutation(token);
  } catch {
    // A marker that cannot be removed keeps safeForBackup false.
    console.error("Backup write gate release failed");
  }
}

export class BackupWritePausedError extends Error {
  constructor() { super("Backup write gate is paused or unavailable"); }
}

export async function runBackupWriteOrReject<T>(work: () => Promise<T>): Promise<T> {
  if (!stagingWriteGateConfigured()) return work();
  let token: string | null;
  try { token = await enterMutation(); } catch { throw new BackupWritePausedError(); }
  if (!token) throw new BackupWritePausedError();
  try { return await work(); } finally { await releaseMutation(token); }
}

export async function runIncidentalBackupWrite<T>(work: () => Promise<T>, skipped: T): Promise<T> {
  if (!stagingWriteGateConfigured()) return work();
  let token: string | null;
  try { token = await enterMutation(); } catch { return skipped; }
  if (!token) return skipped;
  try { return await work(); } finally { await releaseMutation(token); }
}

// Route handlers may schedule persistent work with Next's after(). Reserve its
// marker before the response completes so a later pause waits for that work.
export async function scheduleTrackedBackupWork(
  schedule: (work: () => Promise<void>) => void,
  work: () => Promise<void>,
) {
  if (!stagingWriteGateConfigured()) {
    schedule(work);
    return;
  }

  let token: string | null;
  try { token = await enterMutation(); } catch { token = null; }
  if (!token) {
    // The outer request is already admitted and still counted. Complete its
    // remaining writes before it releases that marker.
    await work();
    return;
  }

  try {
    schedule(async () => {
      try { await work(); } finally { await releaseMutation(token); }
    });
  } catch (error) {
    await releaseMutation(token);
    throw error;
  }
}


// Persistent ownership shares the existing admission lock.
const LEASE_KEY = "backup_write_gate:owned_lease_v1";
type Lease = {
  schema: 1; generation: number; paused: boolean;
  owner: string | null; operationId: string | null; leaseId: string | null;
  releaseHash: string | null;
};
export class BackupGateControlError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); }
}
function requireGate(value: unknown, code: string, status = 409): asserts value {
  if (!value) throw new BackupGateControlError(code, status);
}
const hex = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const operation = (v: unknown): v is string => typeof v === "string" && /^psai-recovery-[A-Za-z0-9-]{8,64}$/.test(v);
const uuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
function object(value: unknown, keys: string[]) {
  requireGate(value && typeof value === "object" && !Array.isArray(value), "GATE_BODY", 400);
  const d = value as Record<string, unknown>;
  requireGate(Object.keys(d).sort().join(",") === keys.sort().join(","), "GATE_BODY", 400);
  return d;
}
async function readLease(tx: Prisma.TransactionClient) {
  const pause = await tx.setting.findUnique({ where: { settingKey: PAUSE_KEY }, select: { settingValue: true } });
  requireGate(!pause || pause.settingValue === "open" || pause.settingValue === "paused", "GATE_STATE_INVALID", 503);
  const stored = await tx.setting.findUnique({ where: { settingKey: LEASE_KEY }, select: { settingValue: true } });
  if (!stored) {
    return { legacyPaused: pause?.settingValue === "paused", lease: {
      schema: 1, generation: 0, paused: pause?.settingValue === "paused",
      owner: null, operationId: null, leaseId: null, releaseHash: null,
    } as Lease };
  }
  let parsed: unknown;
  try { parsed = JSON.parse(stored.settingValue || ""); } catch { throw new BackupGateControlError("GATE_STATE_INVALID", 503); }
  let d: Record<string, unknown>;
  try { d = object(parsed, ["schema", "generation", "paused", "owner", "operationId", "leaseId", "releaseHash"]); }
  catch { throw new BackupGateControlError("GATE_STATE_INVALID", 503); }
  requireGate(d.schema === 1 && Number.isSafeInteger(d.generation) && (d.generation as number) >= 0 && typeof d.paused === "boolean", "GATE_STATE_INVALID", 503);
  requireGate(d.paused ? hex(d.owner) && operation(d.operationId) && uuid(d.leaseId) && hex(d.releaseHash)
    : d.owner === null && d.operationId === null && d.leaseId === null && d.releaseHash === null, "GATE_STATE_INVALID", 503);
  requireGate(Boolean(d.paused) === (pause?.settingValue === "paused") && Boolean(pause), "GATE_STATE_MISMATCH", 503);
  return { legacyPaused: false, lease: d as unknown as Lease };
}
async function snapshot(tx: Prisma.TransactionClient, lease: Lease, legacyPaused = false) {
  const activeMutations = await tx.setting.count({ where: { settingKey: { startsWith: ACTIVE_PREFIX } } });
  return { contract: "owned-lease-v1", releaseProof: "sha256-capability-v1", generation: lease.generation,
    paused: lease.paused, owner: lease.owner, operationId: lease.operationId, leaseId: lease.leaseId,
    legacyPaused, activeMutations, safeForBackup: !legacyPaused && lease.paused && activeMutations === 0 };
}
async function writeLease(tx: Prisma.TransactionClient, lease: Lease) {
  await tx.setting.upsert({ where: { settingKey: LEASE_KEY }, create: { settingKey: LEASE_KEY, settingValue: JSON.stringify(lease) }, update: { settingValue: JSON.stringify(lease) } });
  await tx.setting.upsert({ where: { settingKey: PAUSE_KEY }, create: { settingKey: PAUSE_KEY, settingValue: lease.paused ? "paused" : "open" }, update: { settingValue: lease.paused ? "paused" : "open" } });
}
function validateIdentity(d: Record<string, unknown>) {
  requireGate(d.contract === "owned-lease-v1" && hex(d.owner) && operation(d.operationId)
    && Number.isSafeInteger(d.expectedGeneration) && (d.expectedGeneration as number) >= 0, "GATE_BODY", 400);
}
export async function acquireBackupWriteLease(body: unknown) {
  requireGate(stagingWriteGateConfigured(), "GATE_UNAVAILABLE", 404);
  const d = object(body, ["contract", "owner", "operationId", "expectedGeneration", "releaseHash"]);
  validateIdentity(d); requireGate(hex(d.releaseHash), "GATE_BODY", 400);
  return serialized(async (tx) => {
    const { lease, legacyPaused } = await readLease(tx);
    requireGate(!legacyPaused && !lease.paused, "GATE_ALREADY_PAUSED");
    requireGate(lease.generation === d.expectedGeneration, "GATE_GENERATION_CONFLICT");
    requireGate(lease.generation < Number.MAX_SAFE_INTEGER - 1, "GATE_GENERATION_EXHAUSTED", 503);
    const next: Lease = { schema: 1, generation: lease.generation + 1, paused: true,
      owner: d.owner as string, operationId: d.operationId as string, leaseId: crypto.randomUUID(), releaseHash: d.releaseHash as string };
    await writeLease(tx, next); return snapshot(tx, next);
  });
}
export async function releaseBackupWriteLease(body: unknown) {
  requireGate(stagingWriteGateConfigured(), "GATE_UNAVAILABLE", 404);
  const d = object(body, ["contract", "owner", "operationId", "leaseId", "expectedGeneration", "releaseCapability"]);
  validateIdentity(d); requireGate(uuid(d.leaseId) && hex(d.releaseCapability), "GATE_BODY", 400);
  return serialized(async (tx) => {
    const { lease, legacyPaused } = await readLease(tx);
    requireGate(!legacyPaused && lease.paused && lease.owner === d.owner && lease.operationId === d.operationId
      && lease.leaseId === d.leaseId && lease.generation === d.expectedGeneration, "GATE_LEASE_CONFLICT");
    const digest = crypto.createHash("sha256").update(d.releaseCapability as string).digest();
    requireGate(lease.releaseHash && crypto.timingSafeEqual(digest, Buffer.from(lease.releaseHash, "hex")), "GATE_RELEASE_PROOF", 403);
    requireGate(lease.generation < Number.MAX_SAFE_INTEGER, "GATE_GENERATION_EXHAUSTED", 503);
    const next: Lease = { schema: 1, generation: lease.generation + 1, paused: false, owner: null, operationId: null, leaseId: null, releaseHash: null };
    await writeLease(tx, next); return snapshot(tx, next);
  });
}
// Legacy blind control is deliberately disabled; legacy pauses are never adopted.
export async function setBackupWritePause(_paused: boolean): Promise<never> {
  void _paused; // Neither legacy value authorizes an unowned state transition.
  throw new BackupGateControlError("OWNED_LEASE_REQUIRED", 409);
}
export async function getBackupWriteGateStatus() {
  return serialized(async (tx) => { const { lease, legacyPaused } = await readLease(tx); return snapshot(tx, lease, legacyPaused); });
}

type MutationHandler = (...args: any[]) => Promise<Response>;

export function withBackupWriteGate<T extends MutationHandler>(handler: T): T {
  return (async (...args: Parameters<T>): Promise<Response> => {
    if (!stagingWriteGateConfigured()) return handler(...args);
    let token: string | null;
    try {
      token = await enterMutation();
    } catch {
      console.error("Backup write gate admission unavailable");
      return Response.json({ error: "Writes temporarily unavailable" }, { status: 503, headers: { "Retry-After": "30" } });
    }
    if (!token) {
      return Response.json({ error: "Writes temporarily paused" }, { status: 503, headers: { "Retry-After": "30" } });
    }
    try {
      return await handler(...args);
    } finally {
      await releaseMutation(token);
    }
  }) as T;
}
