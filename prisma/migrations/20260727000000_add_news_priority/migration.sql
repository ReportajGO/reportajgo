-- CreateEnum
CREATE TYPE "NewsPriority" AS ENUM ('BREAKING', 'HIGH', 'NORMAL', 'LOW');

-- AlterTable
ALTER TABLE "NewsItem" ADD COLUMN "priority" "NewsPriority";
