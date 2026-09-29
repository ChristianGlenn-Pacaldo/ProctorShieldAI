ALTER TABLE "evidence_files"
ADD COLUMN "deletion_requested_at" TIMESTAMP(3),
ADD COLUMN "deleted_at" TIMESTAMP(3);

CREATE INDEX "evidence_files_deletion_requested_at_deleted_at_uploaded_at_idx"
ON "evidence_files"("deletion_requested_at", "deleted_at", "uploaded_at");
