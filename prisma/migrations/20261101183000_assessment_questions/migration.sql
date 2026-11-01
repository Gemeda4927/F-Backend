ALTER TABLE "assessments" ADD COLUMN "questions" JSONB NOT NULL DEFAULT '[]'::jsonb;
