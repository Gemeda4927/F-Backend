ALTER TABLE "courses" ADD COLUMN "updated_at" TIMESTAMPTZ(6);
UPDATE "courses" SET "updated_at" = "created_at";
ALTER TABLE "courses" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "courses" ALTER COLUMN "updated_at" SET NOT NULL;
