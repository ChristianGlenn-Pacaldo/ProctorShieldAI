BEGIN;

ALTER TABLE "student_quizzes"
  ADD COLUMN "attempt_number" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "users"
  ADD COLUMN "session_version" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "last_seen_at" TIMESTAMP(3);

DROP INDEX "student_quizzes_student_id_quiz_id_key";
CREATE UNIQUE INDEX "student_quizzes_student_id_quiz_id_attempt_number_key"
  ON "student_quizzes"("student_id", "quiz_id", "attempt_number");

COMMIT;
