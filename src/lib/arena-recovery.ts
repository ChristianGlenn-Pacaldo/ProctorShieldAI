import "server-only";
import type { PrismaClient } from "@prisma/client";
import prisma from "./prisma.ts";
import { mutateArena } from "./arena.ts";
import { recoverArenaAttacks, recoverArenaFinalization } from "./arena-finalization.ts";
import { runIncidentalBackupWrite } from "./backup-write-gate";
import { createArenaRecoveryWorker } from "./arena-recovery-worker.ts";

const PREFIX = "arena:state:";

/** Candidate rows are hints, never authorization. A keyset cursor gives older
 * completed/corrupt rows and failing candidates no power to starve later rows.
 * Each pass scans at most 100 snapshots and attempts at most 25 Arena mutations.
 * The cursor wraps so failures are retried; no per-match timers are required. */
export function createArenaRecoverySweep(client: PrismaClient = prisma) {
  let cursor: string | undefined;
  return async function sweep(signal?: AbortSignal) {
    if (signal?.aborted) return { scanned: 0, attempted: 0, finalized: 0, attacksResolved: 0, failed: 0, paused: 0 };
    const started = Date.now();
    const records = await client.setting.findMany({
      where: { settingKey: { startsWith: PREFIX, ...(cursor ? { gt: cursor } : {}) } },
      orderBy: { settingKey: "asc" }, take: 100,
      select: { settingKey: true, settingValue: true },
    });
    const result = { scanned: 0, attempted: 0, finalized: 0, attacksResolved: 0, failed: 0, paused: 0 };
    for (const record of records) {
      if (signal?.aborted || result.attempted >= 25 || Date.now() - started >= 10_000) break;
      cursor = record.settingKey;
      result.scanned++;
      const quizId = Number(record.settingKey.slice(PREFIX.length));
      if (!Number.isSafeInteger(quizId) || quizId <= 0) continue;
      try {
        const hint = JSON.parse(record.settingValue || "null");
        const overdue = hint?.status === "active" && Object.values(hint.pendingAttacks ?? {}).some((attack) => {
          const pending = attack as { status?: string; expiresAt?: number };
          return pending.status === "pending" && typeof pending.expiresAt === "number" && pending.expiresAt < Date.now();
        });
        if (!hint || hint.finalizedAt || !(overdue || hint.status === "ended"
          || (hint.status === "active" && hint.matchEndsAt && Date.now() >= Date.parse(hint.matchEndsAt)))) continue;
        result.attempted++;
        const finalized = await runIncidentalBackupWrite(() => mutateArena(quizId, async (mutation) => {
          // Another worker, Teacher End, reset, or answer may have won the lock.
          const state = mutation.state;
          if (!state || state.finalizedAt) return { finalized: false, attacksResolved: 0 };
          const quiz = await mutation.tx.quiz.findUnique({ where: { id: quizId }, select: { quizStatus: true, quizMode: true, teacherId: true } });
          if (!quiz || quiz.quizMode !== "arena" || quiz.teacherId !== state.teacherId
            || !["in_progress", "ended"].includes(quiz.quizStatus)) return { finalized: false, attacksResolved: 0 };
          // The finalizer settles overdue combat itself before computing rewards.
          // Active batches are capped; later cursor passes drain remaining attacks.
          const before = Object.values(state.pendingAttacks ?? {}).filter((a) => a.status === "hit").length;
          let attacksResolved = 0;
          if (state.status === "active" && quiz.quizStatus !== "ended" && (!state.matchEndsAt || mutation.now < Date.parse(state.matchEndsAt))) {
            attacksResolved = await recoverArenaAttacks(mutation, { limit: 100 });
          }
          await recoverArenaFinalization(mutation, quiz.quizStatus);
          if (state.finalizedAt) attacksResolved = Object.values(state.attackResults ?? {}).filter((a) => a.status === "hit").length - before;
          return { finalized: !!state.finalizedAt, attacksResolved };
        }, client, { realtimeSignal: signal }), null);
        if (finalized === null) result.paused++;
        else {
          if (finalized.finalized) result.finalized++;
          result.attacksResolved += finalized.attacksResolved;
        }
      } catch {
        result.failed++;
        // Never log exception objects, snapshots, identity or provider payloads.
        console.error("Arena recovery candidate failed; retained for retry", { quizId });
      }
    }
    if (result.scanned === records.length && records.length < 100) cursor = undefined;
    return result;
  };
}

type RecoveryWorker = ReturnType<typeof createArenaRecoveryWorker>;
const runtime = globalThis as typeof globalThis & { arenaRecoveryWorker?: RecoveryWorker };

/** Called only by the production Node server instrumentation hook. */
export function startArenaRecovery() {
  if (runtime.arenaRecoveryWorker) return runtime.arenaRecoveryWorker;
  const sweep = createArenaRecoverySweep();
  const worker = createArenaRecoveryWorker(async (signal) => {
    const result = await sweep(signal);
    console.info("Arena recovery sweep completed", result);
  }, { onError: () => console.error("Arena recovery scan failed; will retry") });
  const shutdown = () => { void stop(); };
  const stop = async () => {
    process.removeListener("SIGTERM", shutdown);
    process.removeListener("SIGINT", shutdown);
    process.removeListener("beforeExit", shutdown);
    await worker.stop();
    if (runtime.arenaRecoveryWorker === handle) delete runtime.arenaRecoveryWorker;
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  process.once("beforeExit", shutdown);
  const handle = { stop };
  runtime.arenaRecoveryWorker = handle;
  return handle;
}
