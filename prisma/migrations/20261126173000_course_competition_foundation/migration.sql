CREATE TABLE "course_competitions" (
  "id" UUID NOT NULL,
  "course_id" UUID NOT NULL,
  "title" TEXT NOT NULL DEFAULT 'Course competition',
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "timezone" TEXT NOT NULL DEFAULT 'Africa/Nairobi',
  "starts_at" TIMESTAMPTZ(6),
  "ends_at" TIMESTAMPTZ(6),
  "rule_version" INTEGER NOT NULL DEFAULT 1,
  "created_by" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "course_competitions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "course_competitions_course_id_key" ON "course_competitions"("course_id");
CREATE INDEX "course_competitions_status_starts_at_ends_at_idx" ON "course_competitions"("status", "starts_at", "ends_at");
ALTER TABLE "course_competitions" ADD CONSTRAINT "course_competitions_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "course_competitions" ADD CONSTRAINT "course_competitions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "competition_point_rules" (
  "id" UUID NOT NULL,
  "competition_id" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "category" TEXT NOT NULL,
  "points" INTEGER NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "competition_point_rules_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "competition_point_rules_competition_id_version_category_key" ON "competition_point_rules"("competition_id", "version", "category");
ALTER TABLE "competition_point_rules" ADD CONSTRAINT "competition_point_rules_competition_id_fkey" FOREIGN KEY ("competition_id") REFERENCES "course_competitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "competition_point_events" (
  "id" UUID NOT NULL,
  "competition_id" UUID NOT NULL,
  "course_id" UUID NOT NULL,
  "student_id" UUID NOT NULL,
  "category" TEXT NOT NULL,
  "source_type" TEXT NOT NULL,
  "source_id" TEXT NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "points" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "competition_point_events_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "competition_point_events_idempotency_key_key" ON "competition_point_events"("idempotency_key");
CREATE INDEX "competition_point_events_competition_id_student_id_created_at_idx" ON "competition_point_events"("competition_id", "student_id", "created_at");
CREATE INDEX "competition_point_events_course_id_category_created_at_idx" ON "competition_point_events"("course_id", "category", "created_at");
ALTER TABLE "competition_point_events" ADD CONSTRAINT "competition_point_events_competition_id_fkey" FOREIGN KEY ("competition_id") REFERENCES "course_competitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "competition_point_events" ADD CONSTRAINT "competition_point_events_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "competition_point_events" ADD CONSTRAINT "competition_point_events_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "competition_visibility" (
  "id" UUID NOT NULL,
  "competition_id" UUID NOT NULL,
  "student_id" UUID NOT NULL,
  "display_name" TEXT,
  "show_on_board" BOOLEAN NOT NULL DEFAULT true,
  "opt_out" BOOLEAN NOT NULL DEFAULT false,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "competition_visibility_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "competition_visibility_competition_id_student_id_key" ON "competition_visibility"("competition_id", "student_id");
ALTER TABLE "competition_visibility" ADD CONSTRAINT "competition_visibility_competition_id_fkey" FOREIGN KEY ("competition_id") REFERENCES "course_competitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "competition_visibility" ADD CONSTRAINT "competition_visibility_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
