import prisma from "./prisma";
import { deleteEvidence } from "./evidence-storage";

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
  const evidenceDays = boundedDays(values.get("evidence_retention_days"), 90);
  const webhookDays = boundedDays(values.get("webhook_retention_days"), 365);
  const evidenceCutoff = new Date(now.getTime() - evidenceDays * 86_400_000);
  const webhookCutoff = new Date(now.getTime() - webhookDays * 86_400_000);

  const expiredEvidenceFiles = await prisma.evidenceFile.findMany({
    where: { violation: { createdAt: { lt: evidenceCutoff } } },
    select: { filePath: true },
  });
  await deleteEvidence(expiredEvidenceFiles.map((file) => file.filePath));

  const [expiredSubscriptions, expiredOtps, removedEvidenceFiles, clearedSnapshots, removedWebhookEvents] =
    await prisma.$transaction([
      prisma.userSubscription.updateMany({
        where: { subscriptionStatus: "active", endDate: { lt: now } },
        data: { subscriptionStatus: "expired" },
      }),
      prisma.otpCode.deleteMany({ where: { expiresAt: { lt: now } } }),
      prisma.evidenceFile.deleteMany({ where: { violation: { createdAt: { lt: evidenceCutoff } } } }),
      prisma.violation.updateMany({
        where: { createdAt: { lt: evidenceCutoff }, screenshotPath: { not: null } },
        data: { screenshotPath: null },
      }),
      prisma.webhookEvent.deleteMany({ where: { processedAt: { lt: webhookCutoff } } }),
    ]);

  return {
    evidenceDays,
    webhookDays,
    expiredSubscriptions: expiredSubscriptions.count,
    expiredOtps: expiredOtps.count,
    removedEvidenceFiles: removedEvidenceFiles.count,
    clearedSnapshots: clearedSnapshots.count,
    removedWebhookEvents: removedWebhookEvents.count,
  };
}
