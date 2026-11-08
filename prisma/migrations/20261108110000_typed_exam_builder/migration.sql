ALTER TABLE "assessments"
 ADD COLUMN "structured" BOOLEAN NOT NULL DEFAULT false,
 ADD COLUMN "question_bank" JSONB NOT NULL DEFAULT '[]',
 ADD COLUMN "published" BOOLEAN NOT NULL DEFAULT true,
 ADD COLUMN "chapter" TEXT NOT NULL DEFAULT '',
 ADD COLUMN "passing_percent" INTEGER NOT NULL DEFAULT 60,
 ADD COLUMN "review_policy" TEXT NOT NULL DEFAULT 'AFTER_SUBMISSION',
 ADD COLUMN "randomize_questions" BOOLEAN NOT NULL DEFAULT false,
 ADD COLUMN "randomize_options" BOOLEAN NOT NULL DEFAULT false,
 ADD COLUMN "allow_navigation" BOOLEAN NOT NULL DEFAULT true,
 ADD COLUMN "allow_resume" BOOLEAN NOT NULL DEFAULT true,
 ADD COLUMN "practice" BOOLEAN NOT NULL DEFAULT false,
 ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "assessment_attempts"
 ADD COLUMN "responses" JSONB NOT NULL DEFAULT '{}',
 ADD COLUMN "grading" JSONB NOT NULL DEFAULT '[]',
 ADD COLUMN "marked" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
 ADD COLUMN "question_order" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
 ADD COLUMN "option_order" JSONB NOT NULL DEFAULT '{}',
 ADD COLUMN "saved_at" TIMESTAMPTZ(6),
 ADD COLUMN "save_version" INTEGER NOT NULL DEFAULT 0,
 ADD COLUMN "access_key" UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE "assessment_submissions" ADD COLUMN "grading" JSONB NOT NULL DEFAULT '[]';
CREATE TABLE "assessment_images" (
 "id" UUID NOT NULL,
 "assessment_id" UUID NOT NULL,
 "name" TEXT NOT NULL,
 "mime_type" TEXT NOT NULL,
 "content" BYTEA NOT NULL,
 CONSTRAINT "assessment_images_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "assessment_images_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "assessments"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "assessment_images_assessment_id_idx" ON "assessment_images"("assessment_id");
