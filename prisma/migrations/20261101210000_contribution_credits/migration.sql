-- CreateTable
CREATE TABLE "contributions" (
    "id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "verifier_id" UUID,
    "verified_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contributions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contribution_votes" (
    "contribution_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contribution_votes_pkey" PRIMARY KEY ("contribution_id","user_id")
);

-- CreateTable
CREATE TABLE "contribution_credit_events" (
    "id" UUID NOT NULL,
    "contribution_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "event" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contribution_credit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contribution_credit_config" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "answer" INTEGER NOT NULL DEFAULT 10,
    "correction" INTEGER NOT NULL DEFAULT 5,
    "resource" INTEGER NOT NULL DEFAULT 3,

    CONSTRAINT "contribution_credit_config_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contributions_course_id_created_at_idx" ON "contributions"("course_id", "created_at");

-- CreateIndex
CREATE INDEX "contribution_credit_events_user_id_created_at_idx" ON "contribution_credit_events"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "contribution_credit_events_contribution_id_event_key" ON "contribution_credit_events"("contribution_id", "event");

-- AddForeignKey
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_verifier_id_fkey" FOREIGN KEY ("verifier_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contribution_votes" ADD CONSTRAINT "contribution_votes_contribution_id_fkey" FOREIGN KEY ("contribution_id") REFERENCES "contributions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contribution_votes" ADD CONSTRAINT "contribution_votes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contribution_credit_events" ADD CONSTRAINT "contribution_credit_events_contribution_id_fkey" FOREIGN KEY ("contribution_id") REFERENCES "contributions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contribution_credit_events" ADD CONSTRAINT "contribution_credit_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
