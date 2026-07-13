CREATE TYPE "NewsStatus" AS ENUM ('NEW', 'FILTERED_OUT', 'SELECTED', 'DRAFTED');
CREATE TYPE "Platform" AS ENUM ('TELEGRAM', 'INSTAGRAM', 'FACEBOOK', 'YOUTUBE', 'WEBSITE', 'X', 'TIKTOK');
CREATE TYPE "PostStatus" AS ENUM ('PENDING_MEDIA', 'PENDING_APPROVAL', 'APPROVED', 'SCHEDULED', 'PUBLISHED', 'REJECTED', 'FAILED');
CREATE TYPE "MediaType" AS ENUM ('IMAGE', 'VIDEO');
CREATE TYPE "MediaStatus" AS ENUM ('QUEUED', 'GENERATING', 'READY', 'FAILED');
CREATE TYPE "ScheduleStatus" AS ENUM ('PENDING', 'PUBLISHING', 'PUBLISHED', 'FAILED', 'CANCELLED');

CREATE TABLE "NewsItem" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "rawContent" TEXT,
  "sourceUrl" TEXT NOT NULL,
  "sourceName" TEXT,
  "language" TEXT NOT NULL,
  "topic" TEXT,
  "publishedAt" TIMESTAMP(3),
  "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "contentHash" TEXT NOT NULL,
  "websiteUrl" TEXT,
  "score" DOUBLE PRECISION,
  "relevance" DOUBLE PRECISION,
  "rankReasons" TEXT,
  "status" "NewsStatus" NOT NULL DEFAULT 'NEW',
  CONSTRAINT "NewsItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PostDraft" (
  "id" TEXT NOT NULL,
  "newsItemId" TEXT NOT NULL,
  "platform" "Platform" NOT NULL,
  "language" TEXT NOT NULL,
  "style" TEXT NOT NULL,
  "headline" TEXT,
  "body" TEXT NOT NULL,
  "hashtags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "status" "PostStatus" NOT NULL DEFAULT 'PENDING_MEDIA',
  "approvedBy" TEXT,
  "approvedAt" TIMESTAMP(3),
  "rejectedReason" TEXT,
  "approvalSentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PostDraft_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MediaAsset" (
  "id" TEXT NOT NULL,
  "draftId" TEXT NOT NULL,
  "type" "MediaType" NOT NULL,
  "provider" TEXT NOT NULL,
  "aspectRatio" TEXT NOT NULL,
  "prompt" TEXT NOT NULL,
  "url" TEXT,
  "localPath" TEXT,
  "externalJobId" TEXT,
  "status" "MediaStatus" NOT NULL DEFAULT 'QUEUED',
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ScheduledPost" (
  "id" TEXT NOT NULL,
  "draftId" TEXT NOT NULL,
  "platform" "Platform" NOT NULL,
  "scheduledAt" TIMESTAMP(3) NOT NULL,
  "status" "ScheduleStatus" NOT NULL DEFAULT 'PENDING',
  "publishedAt" TIMESTAMP(3),
  "externalPostId" TEXT,
  "error" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ScheduledPost_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Setting" (
  "key" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

CREATE UNIQUE INDEX "NewsItem_contentHash_key" ON "NewsItem"("contentHash");
CREATE INDEX "NewsItem_status_idx" ON "NewsItem"("status");
CREATE INDEX "NewsItem_fetchedAt_idx" ON "NewsItem"("fetchedAt");
CREATE INDEX "PostDraft_status_idx" ON "PostDraft"("status");
CREATE INDEX "PostDraft_platform_idx" ON "PostDraft"("platform");
CREATE INDEX "MediaAsset_status_idx" ON "MediaAsset"("status");
CREATE UNIQUE INDEX "ScheduledPost_draftId_key" ON "ScheduledPost"("draftId");
CREATE INDEX "ScheduledPost_status_scheduledAt_idx" ON "ScheduledPost"("status", "scheduledAt");

ALTER TABLE "PostDraft"
  ADD CONSTRAINT "PostDraft_newsItemId_fkey"
  FOREIGN KEY ("newsItemId") REFERENCES "NewsItem"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MediaAsset"
  ADD CONSTRAINT "MediaAsset_draftId_fkey"
  FOREIGN KEY ("draftId") REFERENCES "PostDraft"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ScheduledPost"
  ADD CONSTRAINT "ScheduledPost_draftId_fkey"
  FOREIGN KEY ("draftId") REFERENCES "PostDraft"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
