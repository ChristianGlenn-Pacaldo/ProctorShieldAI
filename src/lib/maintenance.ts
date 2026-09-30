import prisma from "./prisma";
import { deletePendingEvidence, evidenceRetentionCutoff, evidenceRetentionDays } from "./evidence-retention";

const LAST_MAINTENANCE_SUCCESS_KEY = "maintenance_last_success_at";
const MAINTENANCE_STALE_MS = 2 * 60 * 60_000;
const EVIDENCE_BACKLOG_ALERT_COUNT = 100;

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

  // This durable marker is written only after the complete run succeeds. A
  // failed marker write makes the scheduler retry the idempotent maintenance.
  await prisma.setting.upsert({
    where: { settingKey: LAST_MAINTENANCE_SUCCESS_KEY },
    create: { settingKey: LAST_MAINTENANCE_SUCCESS_KEY, settingValue: now.toISOString() },
    update: { settingValue: now.toISOString() },
  });

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

export async function getMaintenanceStatus(now = new Date()) {
  const [marker, pendingEvidenceFiles] = await Promise.all([
    prisma.setting.findUnique({
      where: { settingKey: LAST_MAINTENANCE_SUCCESS_KEY },
      select: { settingValue: true },
    }),
    prisma.evidenceFile.count({ where: { deletionRequestedAt: { not: null }, deletedAt: null } }),
  ]);
  const parsed = marker?.settingValue ? new Date(marker.settingValue) : null;
  const lastSuccessAt = parsed && Number.isFinite(parsed.getTime()) ? parsed : null;
  const ageMs = lastSuccessAt ? now.getTime() - lastSuccessAt.getTime() : Infinity;
  const stale = ageMs < 0 || ageMs > MAINTENANCE_STALE_MS;
  const backlogAlert = pendingEvidenceFiles >= EVIDENCE_BACKLOG_ALERT_COUNT;
  return {
    status: stale || backlogAlert ? "attention" : "ok",
    lastSuccessAt: lastSuccessAt?.toISOString() ?? null,
    pendingEvidenceFiles,
    stale,
    backlogAlert,
  };
}
