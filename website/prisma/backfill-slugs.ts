// Backfill SEO slugs for posts created before the slug column existed.
//
// Idempotent: only touches rows where slug IS NULL, so it is safe to run on
// every deploy (it is chained into the frontend container's start command).
// Reuses lib/slug.ts so backfilled slugs match what new posts get exactly.
//
// Run manually with:
//   DATABASE_URL="postgres://…" npx tsx prisma/backfill-slugs.ts
import { PrismaClient } from "@prisma/client";
import { slugify, buildUniqueSlug } from "../src/lib/slug";

const prisma = new PrismaClient();

async function slugTaken(candidate: string): Promise<boolean> {
  const count = await prisma.post.count({ where: { slug: candidate } });
  return count > 0;
}

async function main(): Promise<void> {
  // Oldest first so the earliest post keeps the clean slug and later duplicates
  // get the numeric suffixes — stable and intuitive.
  const posts = await prisma.post.findMany({
    where: { slug: null },
    select: { id: true, title: true },
    orderBy: { createdAt: "asc" },
  });

  if (posts.length === 0) {
    console.log("[backfill-slugs] no posts need a slug");
    return;
  }
  console.log(`[backfill-slugs] backfilling ${posts.length} post(s)`);

  let done = 0;
  for (const post of posts) {
    const slug = await buildUniqueSlug(slugify(post.title), slugTaken);
    await prisma.post.update({ where: { id: post.id }, data: { slug } });
    done++;
    console.log(`  ✓ ${slug}`);
  }
  console.log(`[backfill-slugs] done: ${done} slug(s) assigned`);
}

main()
  .catch((error) => {
    // Never block container startup on a backfill hiccup (exit 0): new posts
    // still get slugs at creation and legacy id URLs still resolve on their own.
    console.error("[backfill-slugs] failed (continuing):", error);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
