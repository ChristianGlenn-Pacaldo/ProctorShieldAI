-- Additive only: do not infer historical manual grants or payment durations.
ALTER TABLE "user_subscriptions" ADD COLUMN "accounting_sequence" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "user_subscriptions" ADD CONSTRAINT "subscription_accounting_sequence_valid" CHECK ("accounting_sequence" >= 0);
ALTER TABLE "payments" ADD COLUMN "grant_sequence" BIGINT;
ALTER TABLE "payments" ADD CONSTRAINT "payment_grant_sequence_valid" CHECK ("grant_sequence" IS NULL OR ("grant_sequence" > 0 AND "grant_duration_days" IS NOT NULL));
CREATE TABLE "manual_subscription_adjustments" (
  "id" TEXT PRIMARY KEY,
  "subscription_id" TEXT NOT NULL REFERENCES "user_subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "sequence" BIGINT NOT NULL CHECK ("sequence" > 0),
  "kind" TEXT NOT NULL,
  "duration_days" INTEGER,
  "effective_on" DATE NOT NULL,
  "actor_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "manual_adjustment_kind_valid" CHECK (
    ("kind" = 'grant' AND "duration_days" IS NOT NULL AND "duration_days" > 0)
    OR ("kind" = 'revoke' AND "duration_days" IS NULL)
  )
);
CREATE UNIQUE INDEX "manual_subscription_adjustments_subscription_id_sequence_key" ON "manual_subscription_adjustments"("subscription_id", "sequence");
CREATE INDEX "manual_subscription_adjustments_subscription_id_effective_on_idx" ON "manual_subscription_adjustments"("subscription_id", "effective_on");
