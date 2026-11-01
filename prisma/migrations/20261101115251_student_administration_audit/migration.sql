-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN     "actor_name" TEXT,
ADD COLUMN     "actor_role" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "metadata" JSONB,
ADD COLUMN     "new_values" JSONB,
ADD COLUMN     "old_values" JSONB,
ADD COLUMN     "resource_id" UUID,
ADD COLUMN     "resource_type" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "last_login_at" TIMESTAMPTZ(6),
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "suspended" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "audit_logs_target_id_created_at_idx" ON "audit_logs"("target_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_action_created_at_idx" ON "audit_logs"("action", "created_at");
