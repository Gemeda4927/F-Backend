CREATE TABLE "auth_provider_accounts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_account_id" TEXT NOT NULL,
    "email" TEXT,
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_provider_accounts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "auth_provider_accounts_provider_provider_account_id_key"
  ON "auth_provider_accounts"("provider", "provider_account_id");
CREATE UNIQUE INDEX "auth_provider_accounts_user_id_provider_key"
  ON "auth_provider_accounts"("user_id", "provider");
CREATE INDEX "auth_provider_accounts_email_idx"
  ON "auth_provider_accounts"("email");

ALTER TABLE "auth_provider_accounts"
  ADD CONSTRAINT "auth_provider_accounts_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
