-- CreateEnum
CREATE TYPE "LessonStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- AlterTable
ALTER TABLE "lessons" ADD COLUMN     "chapter_id" UUID,
ADD COLUMN     "draft" JSONB,
ADD COLUMN     "published_at" TIMESTAMPTZ(6),
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "status" "LessonStatus" NOT NULL DEFAULT 'PUBLISHED';

-- CreateTable
CREATE TABLE "chapters" (
    "id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chapters_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "chapters_course_id_position_key" ON "chapters"("course_id", "position");

-- CreateIndex
CREATE INDEX "lessons_chapter_id_idx" ON "lessons"("chapter_id");

-- AddForeignKey
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_chapter_id_fkey" FOREIGN KEY ("chapter_id") REFERENCES "chapters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill: existing lessons stay published; chapter names become chapter rows,
-- ordered by the first lesson position inside each chapter.
UPDATE "lessons" SET "published_at" = CURRENT_TIMESTAMP WHERE "published_at" IS NULL;

INSERT INTO "chapters" ("id", "course_id", "title", "position")
SELECT gen_random_uuid(), "course_id", "chapter",
       (ROW_NUMBER() OVER (PARTITION BY "course_id" ORDER BY MIN("position"), "chapter") - 1)::INTEGER
FROM "lessons"
GROUP BY "course_id", "chapter";

UPDATE "lessons" AS l
SET "chapter_id" = c."id"
FROM "chapters" AS c
WHERE c."course_id" = l."course_id" AND c."title" = l."chapter";
