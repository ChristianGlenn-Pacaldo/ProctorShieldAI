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
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(20260930, 6)`;
    return work(tx);
  });
}

async function enterMutation() {
  const token = crypto.randomUUID();
  const admitted = await serialized(async (tx) => {
    const gate = await tx.setting.findUnique({ where: { settingKey: PAUSE_KEY }, select: { settingValue: true } });
    if (gate?.settingValue === "paused") return false;
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

export async function setBackupWritePause(paused: boolean) {
  return serialized(async (tx) => {
    await tx.setting.upsert({
      where: { settingKey: PAUSE_KEY },
      create: { settingKey: PAUSE_KEY, settingValue: paused ? "paused" : "open" },
      update: { settingValue: paused ? "paused" : "open" },
    });
    const activeMutations = await tx.setting.count({ where: { settingKey: { startsWith: ACTIVE_PREFIX } } });
    return { paused, activeMutations, safeForBackup: paused && activeMutations === 0 };
  });
}

export async function getBackupWriteGateStatus() {
  return serialized(async (tx) => {
    const gate = await tx.setting.findUnique({ where: { settingKey: PAUSE_KEY }, select: { settingValue: true } });
    const activeMutations = await tx.setting.count({ where: { settingKey: { startsWith: ACTIVE_PREFIX } } });
    const paused = gate?.settingValue === "paused";
    return { paused, activeMutations, safeForBackup: paused && activeMutations === 0 };
  });
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
