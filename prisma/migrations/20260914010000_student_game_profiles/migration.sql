-- Keep student game currency separate from the user's profile photo and make
-- every reward auditable and idempotent.
CREATE TABLE "student_game_profiles" (
  "student_id" TEXT NOT NULL,
  "coins" INTEGER NOT NULL DEFAULT 100,
  "unlocked_avatars" TEXT[] NOT NULL DEFAULT ARRAY['shield', 'fox', 'owl', 'robot', 'lightning', 'rocket']::TEXT[],
  "equipped_avatar" TEXT NOT NULL DEFAULT 'shield',
  "top_one_wins" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "student_game_profiles_pkey" PRIMARY KEY ("student_id"),
  CONSTRAINT "student_game_profiles_non_negative_coins" CHECK ("coins" >= 0),
  CONSTRAINT "student_game_profiles_non_negative_wins" CHECK ("top_one_wins" >= 0),
  CONSTRAINT "student_game_profiles_student_id_fkey"
    FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "student_coin_ledger" (
  "id" BIGSERIAL NOT NULL,
  "student_id" TEXT NOT NULL,
  "source_type" TEXT NOT NULL,
  "source_id" TEXT NOT NULL,
  "amount" INTEGER NOT NULL,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "student_coin_ledger_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "student_coin_ledger_non_zero_amount" CHECK ("amount" <> 0),
  CONSTRAINT "student_coin_ledger_student_id_fkey"
    FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "student_coin_ledger_student_id_source_type_source_id_key"
  ON "student_coin_ledger"("student_id", "source_type", "source_id");
CREATE INDEX "student_coin_ledger_student_id_created_at_idx"
  ON "student_coin_ledger"("student_id", "created_at");
