ALTER TABLE "lessons" ADD COLUMN "practice" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "assessments" ADD COLUMN "opens_at" TIMESTAMPTZ(6), ADD COLUMN "due_at" TIMESTAMPTZ(6), ADD COLUMN "duration_minutes" INTEGER, ADD COLUMN "max_attempts" INTEGER NOT NULL DEFAULT 1, ADD COLUMN "results_published" BOOLEAN NOT NULL DEFAULT true, ADD COLUMN "allow_files" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "assessments" ADD CONSTRAINT "assessment_limits" CHECK ("max_attempts" BETWEEN 1 AND 10 AND ("duration_minutes" IS NULL OR "duration_minutes" BETWEEN 1 AND 1440) AND ("opens_at" IS NULL OR "due_at" IS NULL OR "opens_at" < "due_at"));
CREATE TABLE "assessment_attempts" (
 "id" UUID PRIMARY KEY, "assessment_id" UUID NOT NULL REFERENCES "assessments"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "student_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "number" INTEGER NOT NULL, "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "expires_at" TIMESTAMPTZ(6), "submitted_at" TIMESTAMPTZ(6), "answer" TEXT, "score" INTEGER, "feedback" TEXT
);
CREATE UNIQUE INDEX "assessment_attempts_assessment_id_student_id_number_key" ON "assessment_attempts"("assessment_id", "student_id", "number");
CREATE TABLE "assessment_files" (
 "id" UUID PRIMARY KEY, "assessment_id" UUID NOT NULL REFERENCES "assessments"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "student_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "name" TEXT NOT NULL, "mime_type" TEXT NOT NULL, "content" BYTEA NOT NULL, "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "assessment_files_assessment_id_student_id_idx" ON "assessment_files"("assessment_id", "student_id");
ALTER TABLE "assessment_submissions" ADD COLUMN "attempt_number" INTEGER NOT NULL DEFAULT 1, ADD COLUMN "attachment_id" UUID REFERENCES "assessment_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "assessment_submissions_attachment_id_key" ON "assessment_submissions"("attachment_id");
CREATE TABLE "notifications" (
 "id" UUID PRIMARY KEY, "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "course_id" UUID REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "event_key" TEXT NOT NULL, "kind" TEXT NOT NULL, "title" TEXT NOT NULL, "message" TEXT NOT NULL, "href" TEXT NOT NULL,
 "read_at" TIMESTAMPTZ(6), "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "notifications_user_id_event_key_key" ON "notifications"("user_id", "event_key");
CREATE INDEX "notifications_user_id_read_at_created_at_idx" ON "notifications"("user_id", "read_at", "created_at");
