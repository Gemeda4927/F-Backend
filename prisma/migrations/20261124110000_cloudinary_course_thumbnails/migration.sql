ALTER TABLE "course_thumbnails"
  ALTER COLUMN "content" DROP NOT NULL,
  ADD COLUMN "storage_provider" TEXT NOT NULL DEFAULT 'database',
  ADD COLUMN "public_id" TEXT,
  ADD COLUMN "secure_url" TEXT;
