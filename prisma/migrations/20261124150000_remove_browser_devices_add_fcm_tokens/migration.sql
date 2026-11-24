CREATE TABLE "fcm_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_encrypted" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "permission_status" TEXT NOT NULL DEFAULT 'granted',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "fcm_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fcm_tokens_token_hash_key" ON "fcm_tokens"("token_hash");
CREATE INDEX "fcm_tokens_user_id_idx" ON "fcm_tokens"("user_id");

INSERT INTO "fcm_tokens" ("id", "user_id", "token_encrypted", "token_hash", "created_at", "updated_at", "last_seen_at")
SELECT DISTINCT ON ("fcm_token_hash") "id", "user_id", "fcm_token_encrypted", "fcm_token_hash", "registered_at", COALESCE("push_updated_at", "registered_at"), "last_seen_at"
FROM "devices"
WHERE "fcm_token_encrypted" IS NOT NULL AND "fcm_token_hash" IS NOT NULL AND "revoked_at" IS NULL
ORDER BY "fcm_token_hash", "push_updated_at" DESC NULLS LAST, "registered_at" DESC;

ALTER TABLE "fcm_tokens"
  ADD CONSTRAINT "fcm_tokens_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "sessions" DROP CONSTRAINT IF EXISTS "sessions_device_id_fkey";
ALTER TABLE "sessions" DROP COLUMN IF EXISTS "device_id";
DROP TABLE IF EXISTS "devices";
