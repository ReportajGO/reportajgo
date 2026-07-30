-- Global Media Network strategy (Reportaj GO Xalqaro OAV Konsepsiya va TZ 2026)
--
-- Adds the strategy dimensions the pipeline now runs on:
--   * 7 content verticals with fixed editorial shares      (TZ §5.1, §5.2)
--   * 21-market targeting                                   (TZ §8)
--   * the 20% ±2% monthly Uzbekistan content quota          (TZ §5.2)
--   * constructive-agenda + verifiability scoring           (TZ §4)
--   * the compliance gate: banned categories + yellow zone  (TZ §6, §6.1)
--   * the three-level approval ladder                       (TZ §10.1)
--   * the per-material content passport                     (TZ §7.2)
--
-- All columns are nullable or defaulted, so existing rows stay valid: historical
-- items simply carry no vertical/market and no compliance verdict.

-- CreateEnum
CREATE TYPE "Vertical" AS ENUM (
  'ECONOMY', 'INNOVATION', 'SCIENCE', 'STARTUP', 'PEOPLE', 'FACTS', 'HISTORY'
);

CREATE TYPE "ContentFormat" AS ENUM (
  'SHORT_VIDEO', 'EXPLAINER_VIDEO', 'TEXT_POST', 'CAROUSEL',
  'MINI_REPORTAGE', 'INTERVIEW', 'ARTICLE', 'INFOGRAPHIC'
);

CREATE TYPE "ComplianceZone" AS ENUM ('GREEN', 'YELLOW', 'RED');

CREATE TYPE "BannedCategory" AS ENUM (
  'POLITICS', 'GEOPOLITICS', 'CONFLICT', 'CRIME', 'DISASTER',
  'VIOLENCE', 'SCANDAL', 'MANIPULATION', 'DIVISIVE_HISTORY'
);

CREATE TYPE "ApprovalTier" AS ENUM ('A', 'B', 'C');

-- AlterTable: NewsItem — strategy dimensions, scoring, compliance
ALTER TABLE "NewsItem"
  ADD COLUMN "vertical"          "Vertical",
  ADD COLUMN "market"            TEXT,
  ADD COLUMN "uzbekistanQuota"   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "constructiveAngle" TEXT,
  ADD COLUMN "additionalSources" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "constructiveness"  DOUBLE PRECISION,
  ADD COLUMN "verifiability"     DOUBLE PRECISION,
  ADD COLUMN "complianceZone"    "ComplianceZone",
  ADD COLUMN "bannedCategories"  "BannedCategory"[] DEFAULT ARRAY[]::"BannedCategory"[],
  ADD COLUMN "yellowRules"       TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "approvalTier"      "ApprovalTier";

CREATE INDEX "NewsItem_vertical_idx" ON "NewsItem"("vertical");
CREATE INDEX "NewsItem_uzbekistanQuota_idx" ON "NewsItem"("uzbekistanQuota");
CREATE INDEX "NewsItem_market_idx" ON "NewsItem"("market");

-- AlterTable: PostDraft — per-market version, passport, approval ladder
ALTER TABLE "PostDraft"
  ADD COLUMN "market"           TEXT,
  ADD COLUMN "format"           "ContentFormat",
  ADD COLUMN "passport"         JSONB,
  ADD COLUMN "approvalTier"     "ApprovalTier",
  ADD COLUMN "nativeQaBy"       TEXT,
  ADD COLUMN "nativeQaAt"       TIMESTAMP(3),
  ADD COLUMN "factCheckedBy"    TEXT,
  ADD COLUMN "factCheckedAt"    TIMESTAMP(3),
  ADD COLUMN "partnershipLabel" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "utmUrl"           TEXT;

CREATE INDEX "PostDraft_market_idx" ON "PostDraft"("market");
CREATE INDEX "PostDraft_format_idx" ON "PostDraft"("format");

-- One draft per (story, platform, market), so a partially-failed fan-out is safe
-- to re-run without duplicating the versions that already succeeded.
--
-- Pre-strategy rows all have market = NULL. In Postgres, NULL values are treated
-- as distinct in a unique index, so historical rows with the same
-- (newsItemId, platform) do NOT collide and this migration cannot fail on them.
CREATE UNIQUE INDEX "PostDraft_newsItemId_platform_market_key"
  ON "PostDraft"("newsItemId", "platform", "market");
