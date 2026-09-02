BEGIN;

-- Fail before changing anything if legacy duplicates would make the new
-- application invariants impossible to enforce.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM student_quizzes GROUP BY student_id, quiz_id HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate student quiz enrollments must be resolved before migration';
  END IF;
  IF EXISTS (
    SELECT 1 FROM answers GROUP BY student_quiz_id, question_id HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate quiz answers must be resolved before migration';
  END IF;
  IF EXISTS (
    SELECT 1 FROM user_subscriptions GROUP BY user_id, plan_id HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate user subscriptions must be resolved before migration';
  END IF;
END $$;

ALTER TABLE "payments"
  ADD COLUMN "provider_payment_id" TEXT,
  ADD COLUMN "refunded_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN "refunded_at" TIMESTAMP(3);

CREATE TABLE "webhook_events" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "event_id" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "webhook_events_event_id_key" ON "webhook_events"("event_id");
CREATE INDEX "webhook_events_provider_processed_at_idx" ON "webhook_events"("provider", "processed_at");
CREATE UNIQUE INDEX "answers_student_quiz_id_question_id_key" ON "answers"("student_quiz_id", "question_id");
CREATE UNIQUE INDEX "payments_provider_payment_id_key" ON "payments"("provider_payment_id");
CREATE INDEX "student_quizzes_quiz_id_quiz_status_idx" ON "student_quizzes"("quiz_id", "quiz_status");
CREATE UNIQUE INDEX "student_quizzes_student_id_quiz_id_key" ON "student_quizzes"("student_id", "quiz_id");
CREATE INDEX "user_subscriptions_subscription_status_end_date_idx" ON "user_subscriptions"("subscription_status", "end_date");
CREATE UNIQUE INDEX "user_subscriptions_user_id_plan_id_key" ON "user_subscriptions"("user_id", "plan_id");

ALTER TABLE "activity_logs" DROP CONSTRAINT "activity_logs_user_id_fkey";
ALTER TABLE "ai_analysis" DROP CONSTRAINT "ai_analysis_student_quiz_id_fkey";
ALTER TABLE "answers" DROP CONSTRAINT "answers_question_id_fkey";
ALTER TABLE "answers" DROP CONSTRAINT "answers_student_quiz_id_fkey";
ALTER TABLE "evidence_files" DROP CONSTRAINT "evidence_files_violation_id_fkey";
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_user_id_fkey";
ALTER TABLE "payments" DROP CONSTRAINT "payments_subscription_id_fkey";
ALTER TABLE "student_quizzes" DROP CONSTRAINT "student_quizzes_quiz_id_fkey";
ALTER TABLE "student_quizzes" DROP CONSTRAINT "student_quizzes_student_id_fkey";
ALTER TABLE "user_subscriptions" DROP CONSTRAINT "user_subscriptions_user_id_fkey";
ALTER TABLE "violations" DROP CONSTRAINT "violations_student_quiz_id_fkey";

ALTER TABLE "student_quizzes" ADD CONSTRAINT "student_quizzes_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "student_quizzes" ADD CONSTRAINT "student_quizzes_quiz_id_fkey" FOREIGN KEY ("quiz_id") REFERENCES "quizzes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "answers" ADD CONSTRAINT "answers_student_quiz_id_fkey" FOREIGN KEY ("student_quiz_id") REFERENCES "student_quizzes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "answers" ADD CONSTRAINT "answers_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "violations" ADD CONSTRAINT "violations_student_quiz_id_fkey" FOREIGN KEY ("student_quiz_id") REFERENCES "student_quizzes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "evidence_files" ADD CONSTRAINT "evidence_files_violation_id_fkey" FOREIGN KEY ("violation_id") REFERENCES "violations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_analysis" ADD CONSTRAINT "ai_analysis_student_quiz_id_fkey" FOREIGN KEY ("student_quiz_id") REFERENCES "student_quizzes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_subscriptions" ADD CONSTRAINT "user_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "user_subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
