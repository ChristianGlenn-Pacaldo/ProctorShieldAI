import prisma from "./prisma";
import { deleteEvidence } from "./evidence-storage";

const DEFAULT_EVIDENCE_RETENTION_DAYS = 90;
const MAX_EVIDENCE_RETENTION_DAYS = 3_650;
const DELETION_BATCH_SIZE = 20;
const DELETION_CONCURRENCY = 5;

export function evidenceRetentionDays(value: string | null | undefined) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= MAX_EVIDENCE_RETENTION_DAYS
    ? parsed
    : DEFAULT_EVIDENCE_RETENTION_DAYS;
}

export function evidenceRetentionCutoff(now: Date, days: number) {
  return new Date(now.getTime() - days * 86_400_000);
}

export class EvidenceWithinRetentionError extends Error {
  constructor(readonly retentionDays: number) {
    super(`Evidence newer than ${retentionDays} days cannot be purged`);
  }
}

export async function requestTeacherEvidencePurge(teacherId: string, now = new Date()) {
  const ownership = { studentQuiz: { quiz: { teacherId } } };

  return prisma.$transaction(async (tx) => {
    const setting = await tx.setting.findUnique({
      where: { settingKey: "evidence_retention_days" },
      select: { settingValue: true },
    });
    const retentionDays = evidenceRetentionDays(setting?.settingValue);
    const cutoff = evidenceRetentionCutoff(now, retentionDays);
    // Reject the whole bulk request if any owned media is still protected.
    // Both checks and updates share one transaction so concurrent purges cannot
    // use a stale preflight decision.
    const recentFile = await tx.evidenceFile.findFirst({
        where: {
          violation: ownership,
          uploadedAt: { gte: cutoff },
          deletionRequestedAt: null,
          deletedAt: null,
        },
        select: { id: true },
      });
    const recentSnapshot = await tx.violation.findFirst({
        where: { ...ownership, createdAt: { gte: cutoff }, screenshotPath: { not: null } },
        select: { id: true },
      });
    if (recentFile || recentSnapshot) throw new EvidenceWithinRetentionError(retentionDays);

    const queued = await tx.evidenceFile.updateMany({
      where: {
        violation: ownership,
        uploadedAt: { lt: cutoff },
        deletionRequestedAt: null,
        deletedAt: null,
      },
      data: { deletionRequestedAt: now },
    });
    const cleared = await tx.violation.updateMany({
      where: { ...ownership, createdAt: { lt: cutoff }, screenshotPath: { not: null } },
      data: { screenshotPath: null },
    });
    return { retentionDays, queuedEvidenceFiles: queued.count, clearedSnapshots: cleared.count };
  }, { timeout: 20_000 });
}

export async function deletePendingEvidence(cutoff: Date, now = new Date()) {
  const pending = await prisma.evidenceFile.findMany({
    where: {
      uploadedAt: { lt: cutoff },
      deletionRequestedAt: { not: null },
      deletedAt: null,
    },
    select: { id: true, filePath: true },
    orderBy: { id: "asc" },
    take: DELETION_BATCH_SIZE,
  });
  let removedEvidenceFiles = 0;
  for (let index = 0; index < pending.length; index += DELETION_CONCURRENCY) {
    const outcomes = await Promise.allSettled(pending.slice(index, index + DELETION_CONCURRENCY).map(async (file) => {
      // The committed row is the durable retry marker. A missing object is safe
      // to delete again if the process stopped before this final DB update.
      await deleteEvidence([file.filePath]);
      const finalized = await prisma.evidenceFile.updateMany({
        where: { id: file.id, deletionRequestedAt: { not: null }, deletedAt: null },
        data: { deletedAt: now },
      });
      return finalized.count;
    }));
    for (const outcome of outcomes) {
      if (outcome.status === "fulfilled") removedEvidenceFiles += outcome.value;
    }
    const failure = outcomes.find((outcome) => outcome.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
  }
  return removedEvidenceFiles;
}
