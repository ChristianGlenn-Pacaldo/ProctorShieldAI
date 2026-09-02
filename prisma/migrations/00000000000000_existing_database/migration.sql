-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "public"."activity_logs" (
    "id" BIGSERIAL NOT NULL,
    "user_id" TEXT NOT NULL,
    "activity" TEXT NOT NULL,
    "ip_address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ai_analysis" (
    "id" SERIAL NOT NULL,
    "total_violations" INTEGER NOT NULL DEFAULT 0,
    "cheating_probability" DECIMAL(5,2),
    "risk_level" TEXT,
    "final_verdict" TEXT,
    "ai_explanation" TEXT,
    "analyzed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "student_quiz_id" TEXT NOT NULL,

    CONSTRAINT "ai_analysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."answers" (
    "id" BIGSERIAL NOT NULL,
    "question_id" INTEGER NOT NULL,
    "answer_text" TEXT,
    "is_correct" BOOLEAN,
    "points_earned" INTEGER,
    "student_quiz_id" TEXT NOT NULL,

    CONSTRAINT "answers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."choices" (
    "id" SERIAL NOT NULL,
    "question_id" INTEGER NOT NULL,
    "choice_text" TEXT NOT NULL,
    "is_correct" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "choices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."evidence_files" (
    "id" BIGSERIAL NOT NULL,
    "violation_id" BIGINT NOT NULL,
    "file_type" TEXT,
    "file_path" TEXT NOT NULL,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evidence_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."notifications" (
    "id" BIGSERIAL NOT NULL,
    "user_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."otp_codes" (
    "id" SERIAL NOT NULL,
    "user_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."payments" (
    "id" TEXT NOT NULL,
    "subscription_id" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "payment_method" TEXT,
    "payment_status" TEXT,
    "transaction_reference" TEXT,
    "paid_at" TIMESTAMP(3),

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."questions" (
    "id" SERIAL NOT NULL,
    "question_text" TEXT NOT NULL,
    "question_type" TEXT,
    "points" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "quiz_id" INTEGER NOT NULL,

    CONSTRAINT "questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."quizzes" (
    "id" SERIAL NOT NULL,
    "subject_id" INTEGER NOT NULL,
    "teacher_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "access_code" TEXT,
    "is_ai_generated" BOOLEAN NOT NULL DEFAULT false,
    "source_file_path" TEXT,
    "quiz_type" TEXT,
    "duration" INTEGER,
    "total_questions" INTEGER,
    "passing_score" INTEGER,
    "shuffle_questions" BOOLEAN NOT NULL DEFAULT false,
    "allow_retake" BOOLEAN NOT NULL DEFAULT false,
    "quiz_status" TEXT NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_gamified" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "quizzes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."roles" (
    "id" SERIAL NOT NULL,
    "role_name" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."settings" (
    "id" SERIAL NOT NULL,
    "setting_key" TEXT NOT NULL,
    "setting_value" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."student_quizzes" (
    "id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "quiz_id" INTEGER NOT NULL,
    "random_seed" TEXT,
    "start_time" TIMESTAMP(3),
    "end_time" TIMESTAMP(3),
    "score" DECIMAL(5,2),
    "remarks" TEXT,
    "ai_verdict" TEXT,
    "cheating_probability" DECIMAL(5,2),
    "quiz_status" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "device_capabilities" JSONB,
    "device_type" TEXT,
    "last_heartbeat_at" TIMESTAMP(3),
    "monitoring_level" TEXT,

    CONSTRAINT "student_quizzes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."subjects" (
    "id" SERIAL NOT NULL,
    "teacher_id" TEXT NOT NULL,
    "subject_name" TEXT NOT NULL,
    "subject_code" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subjects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."subscription_plans" (
    "id" SERIAL NOT NULL,
    "plan_name" TEXT NOT NULL,
    "yearly_price" DECIMAL(10,2),
    "features" TEXT,
    "duration_days" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."user_subscriptions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "plan_id" INTEGER NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "payment_status" TEXT,
    "subscription_status" TEXT,

    CONSTRAINT "user_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."users" (
    "id" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "google_id" TEXT,
    "profile_image" TEXT,
    "role_id" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "is_online" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."violations" (
    "id" BIGSERIAL NOT NULL,
    "violation_type" TEXT,
    "confidence_score" DECIMAL(5,2),
    "timestamp" TIMESTAMP(3) NOT NULL,
    "duration_seconds" INTEGER,
    "screenshot_path" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "student_quiz_id" TEXT NOT NULL,

    CONSTRAINT "violations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_analysis_student_quiz_id_key" ON "public"."ai_analysis"("student_quiz_id" ASC);

-- CreateIndex
CREATE INDEX "otp_codes_user_id_idx" ON "public"."otp_codes"("user_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "payments_transaction_reference_key" ON "public"."payments"("transaction_reference" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "quizzes_access_code_key" ON "public"."quizzes"("access_code" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "roles_role_name_key" ON "public"."roles"("role_name" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "settings_setting_key_key" ON "public"."settings"("setting_key" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "subjects_subject_code_key" ON "public"."subjects"("subject_code" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "public"."users"("email" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "users_google_id_key" ON "public"."users"("google_id" ASC);

-- AddForeignKey
ALTER TABLE "public"."activity_logs" ADD CONSTRAINT "activity_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ai_analysis" ADD CONSTRAINT "ai_analysis_student_quiz_id_fkey" FOREIGN KEY ("student_quiz_id") REFERENCES "public"."student_quizzes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."answers" ADD CONSTRAINT "answers_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."answers" ADD CONSTRAINT "answers_student_quiz_id_fkey" FOREIGN KEY ("student_quiz_id") REFERENCES "public"."student_quizzes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."choices" ADD CONSTRAINT "choices_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."evidence_files" ADD CONSTRAINT "evidence_files_violation_id_fkey" FOREIGN KEY ("violation_id") REFERENCES "public"."violations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."otp_codes" ADD CONSTRAINT "otp_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."payments" ADD CONSTRAINT "payments_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "public"."user_subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."questions" ADD CONSTRAINT "questions_quiz_id_fkey" FOREIGN KEY ("quiz_id") REFERENCES "public"."quizzes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."quizzes" ADD CONSTRAINT "quizzes_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."quizzes" ADD CONSTRAINT "quizzes_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."student_quizzes" ADD CONSTRAINT "student_quizzes_quiz_id_fkey" FOREIGN KEY ("quiz_id") REFERENCES "public"."quizzes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."student_quizzes" ADD CONSTRAINT "student_quizzes_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."subjects" ADD CONSTRAINT "subjects_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."user_subscriptions" ADD CONSTRAINT "user_subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "public"."subscription_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."user_subscriptions" ADD CONSTRAINT "user_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."users" ADD CONSTRAINT "users_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."violations" ADD CONSTRAINT "violations_student_quiz_id_fkey" FOREIGN KEY ("student_quiz_id") REFERENCES "public"."student_quizzes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
