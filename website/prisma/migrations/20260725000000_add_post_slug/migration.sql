-- Add a human/SEO-friendly URL slug to posts.
-- Nullable so the column can be added to the existing table with no downtime;
-- existing rows are backfilled by scripts/backfill-slugs.ts (run on deploy).
-- Postgres treats NULLs as distinct, so the unique index tolerates un-backfilled
-- rows until they are filled.
ALTER TABLE "Post" ADD COLUMN "slug" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Post_slug_key" ON "Post"("slug");
