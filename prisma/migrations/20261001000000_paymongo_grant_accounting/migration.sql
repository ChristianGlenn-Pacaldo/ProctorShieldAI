-- Deliberately nullable: existing expiry is preserved and historical grants
-- cannot be inferred from current plan prices/durations or payment timestamps.
ALTER TABLE "user_subscriptions"
  ADD COLUMN "grant_baseline_at" DATE,
  ADD COLUMN "grant_baseline_end_date" DATE;
ALTER TABLE "payments"
  ADD COLUMN "grant_duration_days" INTEGER,
  ADD COLUMN "grant_revoked_on" DATE;
ALTER TABLE "user_subscriptions" ADD CONSTRAINT "subscription_grant_baseline_pair"
  CHECK (("grant_baseline_at" IS NULL) = ("grant_baseline_end_date" IS NULL));
ALTER TABLE "payments" ADD CONSTRAINT "payment_grant_snapshot_valid"
  CHECK ("grant_duration_days" IS NULL OR ("grant_duration_days" > 0 AND "paid_at" IS NOT NULL));
ALTER TABLE "payments" ADD CONSTRAINT "payment_grant_revocation_valid"
  CHECK ("grant_revoked_on" IS NULL OR ("grant_duration_days" IS NOT NULL AND "grant_revoked_on" >= "paid_at"::date));
ALTER TABLE "payments" ADD CONSTRAINT "payment_grant_refund_consistent"
  CHECK ("grant_duration_days" IS NULL OR
    (("refunded_amount" < "amount" AND "grant_revoked_on" IS NULL) OR
     ("refunded_amount" >= "amount" AND "grant_revoked_on" IS NOT NULL)));
CREATE INDEX "payments_subscription_id_paid_at_idx" ON "payments"("subscription_id", "paid_at");
