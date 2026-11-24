DROP INDEX IF EXISTS "one_active_installation";

CREATE UNIQUE INDEX "one_active_user_installation"
  ON "devices"("user_id", "installation_hash")
  WHERE "revoked_at" IS NULL AND "installation_hash" IS NOT NULL;
