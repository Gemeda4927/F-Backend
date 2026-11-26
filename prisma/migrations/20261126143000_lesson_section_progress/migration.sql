CREATE TABLE "lesson_section_progress" (
  "user_id" UUID NOT NULL,
  "lesson_id" UUID NOT NULL,
  "section_id" TEXT NOT NULL,
  "completed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_visited" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "lesson_section_progress_pkey" PRIMARY KEY ("user_id", "lesson_id", "section_id"),
  CONSTRAINT "lesson_section_progress_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "lesson_section_progress_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "lesson_section_progress_lesson_id_section_id_idx" ON "lesson_section_progress"("lesson_id", "section_id");
