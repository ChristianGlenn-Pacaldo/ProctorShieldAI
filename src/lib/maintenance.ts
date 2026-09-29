import prisma from "./prisma";
import { deletePendingEvidence, evidenceRetentionCutoff, evidenceRetentionDays } from "./evidence-retention";

export async function expireSubscriptions(userId?: string) {
  return prisma.userSubscription.updateMany({
    where: {
      ...(userId ? { userId } : {}),
      subscriptionStatus: "active",
      endDate: { lt: new Date() },
    },
    data: { subscriptionStatus: "expired" },
  });
}

function boundedDays(value: string | null | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 3_650 ? parsed : fallback;
}

export async function runMaintenance(now = new Date()) {
  const retentionSettings = await prisma.setting.findMany({
    where: { settingKey: { in: ["evidence_retention_days", "webhook_retention_days"] } },
  });
  const values = new Map(retentionSettings.map((setting) => [setting.settingKey, setting.settingValue]));
  const evidenceDays = evidenceRetentionDays(values.get("evidence_retention_days"));
  const webhookDays = boundedDays(values.get("webhook_retention_days"), 365);
  const evidenceCutoff = evidenceRetentionCutoff(now, evidenceDays);
  const webhookCutoff = new Date(now.getTime() - webhookDays * 86_400_000);

  const presenceCutoff = new Date(now.getTime() - 2 * 60_000);
  const counts = await prisma.$transaction(async (tx) => {
    const expiredSubscriptions = await tx.userSubscription.updateMany({
        where: { subscriptionStatus: "active", endDate: { lt: now } },
        data: { subscriptionStatus: "expired" },
      });
    const expiredOtps = await tx.otpCode.deleteMany({ where: { expiresAt: { lt: now } } });
    const queuedEvidenceFiles = await tx.evidenceFile.updateMany({
        where: {
          uploadedAt: { lt: evidenceCutoff },
          deletionRequestedAt: null,
          deletedAt: null,
        },
        data: { deletionRequestedAt: now },
      });
    const clearedSnapshots = await tx.violation.updateMany({
        where: { createdAt: { lt: evidenceCutoff }, screenshotPath: { not: null } },
        data: { screenshotPath: null },
      });
    const removedWebhookEvents = await tx.webhookEvent.deleteMany({ where: { processedAt: { lt: webhookCutoff } } });
    const clearedPresence = await tx.user.updateMany({
        where: {
          isOnline: true,
          OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: presenceCutoff } }],
        },
        data: { isOnline: false },
      });
    return { expiredSubscriptions, expiredOtps, queuedEvidenceFiles, clearedSnapshots, removedWebhookEvents, clearedPresence };
  }, { timeout: 20_000 });
  // External storage is touched only after the deletion request commits.
  // A failed object delete or final DB update leaves the queued row for retry.
  const removedEvidenceFiles = await deletePendingEvidence(evidenceCutoff, now);

  return {
    evidenceDays,
    webhookDays,
    expiredSubscriptions: counts.expiredSubscriptions.count,
    expiredOtps: counts.expiredOtps.count,
    queuedEvidenceFiles: counts.queuedEvidenceFiles.count,
    removedEvidenceFiles,
    clearedSnapshots: counts.clearedSnapshots.count,
    removedWebhookEvents: counts.removedWebhookEvents.count,
    clearedPresence: counts.clearedPresence.count,
  };
}
