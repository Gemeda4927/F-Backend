-- CreateEnum
CREATE TYPE "CourseVisibility" AS ENUM ('PUBLIC', 'PRIVATE', 'UNLISTED');

-- AlterTable
ALTER TABLE "courses" ADD COLUMN     "visibility" "CourseVisibility" NOT NULL DEFAULT 'PRIVATE';
