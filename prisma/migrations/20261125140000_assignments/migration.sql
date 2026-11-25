CREATE TABLE "assignments" (
  "id" UUID NOT NULL,
  "course_id" UUID NOT NULL,
  "created_by" UUID NOT NULL,
  "title" TEXT NOT NULL,
  "university" TEXT,
  "department" TEXT,
  "program" TEXT,
  "chapter" TEXT NOT NULL DEFAULT '',
  "description" TEXT NOT NULL DEFAULT '',
  "assignment_type" TEXT NOT NULL DEFAULT 'QUESTIONS_WITH_SOLUTIONS',
  "access_type" TEXT NOT NULL DEFAULT 'FREE',
  "published" BOOLEAN NOT NULL DEFAULT false,
  "archived" BOOLEAN NOT NULL DEFAULT false,
  "published_at" TIMESTAMPTZ(6),
  "total_pages" INTEGER NOT NULL DEFAULT 0,
  "document_public_id" TEXT,
  "document_url" TEXT,
  "document_resource_type" TEXT,
  "document_version" INTEGER,
  "document_bytes" INTEGER,
  "document_mime_type" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "assignments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "assignments_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "assignments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "assignments_course_id_published_archived_idx" ON "assignments"("course_id", "published", "archived");
CREATE INDEX "assignments_created_by_created_at_idx" ON "assignments"("created_by", "created_at");
CREATE TABLE "assignment_views" (
  "id" UUID NOT NULL,
  "assignment_id" UUID NOT NULL,
  "student_id" UUID NOT NULL,
  "first_viewed" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_viewed" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "view_count" INTEGER NOT NULL DEFAULT 0,
  "last_page" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "assignment_views_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "assignment_views_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "assignment_views_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "assignment_views_assignment_id_student_id_key" UNIQUE ("assignment_id", "student_id")
);
CREATE INDEX "assignment_views_assignment_id_last_viewed_idx" ON "assignment_views"("assignment_id", "last_viewed");
CREATE TABLE "assignment_access_attempts" (
  "id" UUID NOT NULL,
  "assignment_id" UUID NOT NULL,
  "student_id" UUID,
  "reason" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "assignment_access_attempts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "assignment_access_attempts_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "assignment_access_attempts_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "assignment_access_attempts_assignment_id_created_at_idx" ON "assignment_access_attempts"("assignment_id", "created_at");
