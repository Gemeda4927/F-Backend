ALTER TABLE "assignments"
  ADD COLUMN "task_mode" TEXT NOT NULL DEFAULT 'DOCUMENT',
  ADD COLUMN "difficulty" TEXT,
  ADD COLUMN "max_marks" INTEGER,
  ADD COLUMN "passing_marks" INTEGER,
  ADD COLUMN "deadline" TIMESTAMPTZ(6),
  ADD COLUMN "late_policy" TEXT,
  ADD COLUMN "max_attempts" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "instructions_markdown" TEXT;

CREATE TABLE "assignment_task_attachments" (
  "id" UUID NOT NULL,
  "assignment_id" UUID NOT NULL,
  "public_id" TEXT NOT NULL,
  "secure_url" TEXT NOT NULL,
  "resource_type" TEXT NOT NULL DEFAULT 'image',
  "original_name" TEXT NOT NULL,
  "mime_type" TEXT NOT NULL,
  "bytes" INTEGER NOT NULL,
  "version" INTEGER,
  "uploaded_by" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "assignment_task_attachments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "assignment_task_attachments_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "assignment_task_attachments_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "assignment_task_attachments_assignment_id_created_at_idx" ON "assignment_task_attachments"("assignment_id", "created_at");

CREATE TABLE "assignment_rubric_criteria" (
  "id" UUID NOT NULL,
  "assignment_id" UUID NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "max_marks" INTEGER NOT NULL,
  "position" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "assignment_rubric_criteria_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "assignment_rubric_criteria_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "assignment_rubric_criteria_assignment_id_position_idx" ON "assignment_rubric_criteria"("assignment_id", "position");

CREATE TABLE "assignment_submissions" (
  "id" UUID NOT NULL,
  "assignment_id" UUID NOT NULL,
  "student_id" UUID NOT NULL,
  "attempt_number" INTEGER NOT NULL DEFAULT 1,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "answer_markdown" TEXT NOT NULL DEFAULT '',
  "score" INTEGER,
  "feedback" TEXT,
  "reviewer_id" UUID,
  "submitted_at" TIMESTAMPTZ(6),
  "reviewed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "assignment_submissions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "assignment_submissions_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "assignment_submissions_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "assignment_submissions_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "assignment_submissions_assignment_id_student_id_attempt_number_key" ON "assignment_submissions"("assignment_id", "student_id", "attempt_number");
CREATE INDEX "assignment_submissions_assignment_id_status_idx" ON "assignment_submissions"("assignment_id", "status");
CREATE INDEX "assignment_submissions_student_id_updated_at_idx" ON "assignment_submissions"("student_id", "updated_at");

CREATE TABLE "assignment_submission_files" (
  "id" UUID NOT NULL,
  "submission_id" UUID NOT NULL,
  "public_id" TEXT NOT NULL,
  "secure_url" TEXT NOT NULL,
  "resource_type" TEXT NOT NULL DEFAULT 'raw',
  "original_name" TEXT NOT NULL,
  "mime_type" TEXT NOT NULL,
  "bytes" INTEGER NOT NULL,
  "version" INTEGER,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "assignment_submission_files_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "assignment_submission_files_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "assignment_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "assignment_submission_files_submission_id_created_at_idx" ON "assignment_submission_files"("submission_id", "created_at");

CREATE TABLE "assignment_evaluations" (
  "id" UUID NOT NULL,
  "submission_id" UUID NOT NULL,
  "evaluator_id" UUID NOT NULL,
  "decision" TEXT NOT NULL,
  "total_score" INTEGER,
  "feedback" TEXT NOT NULL DEFAULT '',
  "rubric_scores" JSONB NOT NULL DEFAULT '[]',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "assignment_evaluations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "assignment_evaluations_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "assignment_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "assignment_evaluations_evaluator_id_fkey" FOREIGN KEY ("evaluator_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "assignment_evaluations_submission_id_created_at_idx" ON "assignment_evaluations"("submission_id", "created_at");
