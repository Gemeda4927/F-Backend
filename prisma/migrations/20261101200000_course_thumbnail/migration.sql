-- CreateTable
CREATE TABLE "course_thumbnails" (
    "course_id" UUID NOT NULL,
    "content" BYTEA NOT NULL,
    "mime_type" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "course_thumbnails_pkey" PRIMARY KEY ("course_id")
);

-- AddForeignKey
ALTER TABLE "course_thumbnails" ADD CONSTRAINT "course_thumbnails_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
