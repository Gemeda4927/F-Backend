CREATE TYPE "ExamType" AS ENUM ('MID', 'FINAL', 'EXIT');

ALTER TABLE "assessments"
ADD COLUMN "exam_type" "ExamType",
ADD COLUMN "university" TEXT,
ADD COLUMN "campus" TEXT,
ADD COLUMN "department" TEXT;

CREATE INDEX "assessments_published_exam_type_university_campus_department_idx"
ON "assessments"("published", "exam_type", "university", "campus", "department");
