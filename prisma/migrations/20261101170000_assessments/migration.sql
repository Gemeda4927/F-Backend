CREATE TABLE "assessments" (
  "id" UUID NOT NULL, "course_id" UUID NOT NULL, "title" TEXT NOT NULL,
  "kind" TEXT NOT NULL, "prompt" TEXT NOT NULL, "max_score" INTEGER NOT NULL DEFAULT 100,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "assessments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "assessments_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "assessments_course_id_idx" ON "assessments"("course_id");
CREATE TABLE "assessment_submissions" (
  "id" UUID NOT NULL, "assessment_id" UUID NOT NULL, "student_id" UUID NOT NULL,
  "answer" TEXT NOT NULL, "submitted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "score" INTEGER, "feedback" TEXT, "reviewed_at" TIMESTAMPTZ(6),
  CONSTRAINT "assessment_submissions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "assessment_submissions_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "assessments"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "assessment_submissions_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "assessment_submissions_assessment_id_student_id_key" ON "assessment_submissions"("assessment_id", "student_id");
CREATE INDEX "assessment_submissions_student_id_idx" ON "assessment_submissions"("student_id");
