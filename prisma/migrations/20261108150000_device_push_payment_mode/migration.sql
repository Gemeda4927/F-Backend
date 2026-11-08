ALTER TABLE "devices" ADD COLUMN "installation_hash" TEXT, ADD COLUMN "fcm_token_encrypted" TEXT, ADD COLUMN "fcm_token_hash" TEXT, ADD COLUMN "platform" TEXT NOT NULL DEFAULT 'web', ADD COLUMN "browser" TEXT, ADD COLUMN "operating_system" TEXT, ADD COLUMN "push_updated_at" TIMESTAMPTZ(6);
CREATE UNIQUE INDEX "one_active_installation" ON "devices"("installation_hash") WHERE "revoked_at" IS NULL;
ALTER TABLE "notifications" ADD COLUMN "push_delivered_at" TIMESTAMPTZ(6), ADD COLUMN "push_claimed_at" TIMESTAMPTZ(6), ADD COLUMN "push_attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "payments" ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'unknown', ADD COLUMN "verified_at" TIMESTAMPTZ(6);
CREATE INDEX "payments_mode_status" ON "payments"("mode", "status");
CREATE UNIQUE INDEX "one_active_fcm_registration" ON "devices"("fcm_token_hash") WHERE "revoked_at" IS NULL;
-- The configurable active-device limit is enforced under the existing serializable user-row lock.
-- Retain globally unique installation and authorization-token indexes.
DROP INDEX "one_registered_device_per_student";
CREATE INDEX "devices_active_user" ON "devices"("user_id") WHERE "revoked_at" IS NULL;
