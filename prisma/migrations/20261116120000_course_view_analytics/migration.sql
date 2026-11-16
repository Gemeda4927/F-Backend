CREATE TABLE "course_views" (
    "id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "session_key" TEXT NOT NULL,
    "opened_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "course_views_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "course_views_session_key_key" ON "course_views"("session_key");
CREATE INDEX "course_views_course_id_opened_at_idx" ON "course_views"("course_id", "opened_at");
CREATE INDEX "course_views_student_id_opened_at_idx" ON "course_views"("student_id", "opened_at");
CREATE INDEX "course_views_course_id_student_id_opened_at_idx" ON "course_views"("course_id", "student_id", "opened_at");
ALTER TABLE "course_views" ADD CONSTRAINT "course_views_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "course_views" ADD CONSTRAINT "course_views_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
