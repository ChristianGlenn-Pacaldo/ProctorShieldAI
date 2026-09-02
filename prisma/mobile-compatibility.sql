ALTER TABLE "student_quizzes"
  ADD COLUMN IF NOT EXISTS "device_capabilities" JSONB,
  ADD COLUMN IF NOT EXISTS "device_type" TEXT,
  ADD COLUMN IF NOT EXISTS "last_heartbeat_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "monitoring_level" TEXT;
