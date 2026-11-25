ALTER TABLE "payments"
  ADD COLUMN "payment_method" TEXT,
  ADD COLUMN "payer_name" TEXT,
  ADD COLUMN "payment_date" DATE,
  ADD COLUMN "admin_remark" TEXT,
  ADD COLUMN "verified_by" UUID,
  ADD COLUMN "receipt_public_id" TEXT,
  ADD COLUMN "receipt_resource_type" TEXT,
  ADD COLUMN "receipt_url" TEXT,
  ADD COLUMN "receipt_original_name" TEXT,
  ADD COLUMN "receipt_mime_type" TEXT,
  ADD COLUMN "receipt_bytes" INTEGER;

CREATE INDEX "payments_reference_status_idx" ON "payments" ("tx_ref", "status");
