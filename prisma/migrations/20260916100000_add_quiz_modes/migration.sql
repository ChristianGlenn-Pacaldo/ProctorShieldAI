-- AlterTable quizzes: Add quiz_mode with default 'proctored'
ALTER TABLE "quizzes" ADD COLUMN "quiz_mode" TEXT NOT NULL DEFAULT 'proctored';

-- Add Check Constraint for quizzes.quiz_mode
ALTER TABLE "quizzes" ADD CONSTRAINT "quizzes_quiz_mode_check" CHECK ("quiz_mode" IN ('proctored', 'arena'));

-- AlterTable student_quizzes: Add attempt_mode with default 'proctored'
ALTER TABLE "student_quizzes" ADD COLUMN "attempt_mode" TEXT NOT NULL DEFAULT 'proctored';

-- Add Check Constraint for student_quizzes.attempt_mode
ALTER TABLE "student_quizzes" ADD CONSTRAINT "student_quizzes_attempt_mode_check" CHECK ("attempt_mode" IN ('proctored', 'arena'));

-- Create Index for quizzes(quiz_mode)
CREATE INDEX "quizzes_quiz_mode_idx" ON "quizzes"("quiz_mode");

-- Create Index for student_quizzes(attempt_mode)
CREATE INDEX "student_quizzes_attempt_mode_idx" ON "student_quizzes"("attempt_mode");
