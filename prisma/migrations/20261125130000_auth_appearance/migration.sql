CREATE TABLE "auth_appearance" (
  "id" TEXT NOT NULL DEFAULT 'default',
  "headline" TEXT NOT NULL DEFAULT 'Your next chapter starts here.',
  "description" TEXT NOT NULL DEFAULT 'Build practical skills, learn from expert-led courses, and keep moving toward the future you want.',
  "slogan" TEXT NOT NULL DEFAULT 'Learn Today. Innovate Tomorrow.',
  "overlay_opacity" DOUBLE PRECISION NOT NULL DEFAULT 0.48,
  "public_id" TEXT,
  "secure_url" TEXT,
  "mime_type" TEXT,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "auth_appearance_pkey" PRIMARY KEY ("id")
);
