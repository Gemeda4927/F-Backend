CREATE TABLE "lesson_images" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "lesson_id" UUID NOT NULL,
  "public_id" TEXT NOT NULL,
  "secure_url" TEXT NOT NULL,
  "resource_type" TEXT NOT NULL DEFAULT 'image',
  "original_name" TEXT NOT NULL,
  "alt_text" TEXT NOT NULL DEFAULT '',
  "caption" TEXT,
  "display_size" TEXT NOT NULL DEFAULT 'medium',
  "width" INTEGER,
  "height" INTEGER,
  "bytes" INTEGER NOT NULL,
  "uploaded_by" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "lesson_images_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "lesson_images_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "lesson_images_lesson_id_created_at_idx" ON "lesson_images"("lesson_id", "created_at");
