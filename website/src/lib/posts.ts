import { cache } from "react";
import { prisma } from "./prisma";
import type { CategorySlug } from "./constants";
import type { Translations } from "./translate";

// Shape consumed by the UI (category flattened to its slug + localized name).
export type PostDTO = {
  id: string;
  slug: string; // SEO URL slug; falls back to id for any un-backfilled post
  title: string;
  excerpt: string;
  body: string;
  imageUrl: string | null;
  language: string;
  category: CategorySlug;
  categoryName: string; // localized theme label (falls back to the slug)
  breaking: boolean;
  published: boolean;
  cleared: boolean; // soft-deleted via admin "Clear" (recoverable)
  views: number;
  aspect: string;
  gallery: string[];
  author: string | null;
  createdAt: string;
  updatedAt: string; // ISO; feeds JSON-LD dateModified + sitemap lastmod
};

type WithCategoryAuthor = {
  id: string;
  slug: string | null;
  title: string;
  excerpt: string;
  body: string;
  imageUrl: string | null;
  language: string;
  translations: string | null;
  breaking: boolean;
  published: boolean;
  views: number;
  aspect: string;
  gallery: string | null;
  clearedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  category: { slug: string; labels: string | null };
  author: { name: string | null } | null;
};

/** Localized theme label from a Category.labels JSON blob (slug fallback). */
function labelFor(labels: string | null, slug: string, locale?: string): string {
  if (labels && locale) {
    try {
      const map = JSON.parse(labels) as Record<string, string>;
      if (map?.[locale]) return map[locale];
    } catch {
      /* fall through to slug */
    }
  }
  return slug;
}

function parseTranslations(raw: string | null): Translations | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Translations;
  } catch {
    return null;
  }
}

/**
 * Build a UI DTO. When `locale` is given, title/excerpt/body are rendered in
 * that language (falling back to the base text if a translation is missing).
 * Without a locale (admin), the original source text is used.
 */
function toDTO(p: WithCategoryAuthor, locale?: string): PostDTO {
  const tr = locale ? parseTranslations(p.translations)?.[locale] : undefined;
  return {
    id: p.id,
    slug: p.slug ?? p.id, // pretty slug when present; legacy id keeps links working
    title: tr?.title || p.title,
    excerpt: tr?.excerpt || p.excerpt,
    body: tr?.body || p.body,
    imageUrl: p.imageUrl,
    language: p.language,
    category: p.category.slug,
    categoryName: labelFor(p.category.labels, p.category.slug, locale),
    breaking: p.breaking,
    published: p.published,
    cleared: p.clearedAt != null,
    views: p.views,
    aspect: p.aspect,
    gallery: parseGallery(p.gallery),
    author: p.author?.name ?? null,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

function parseGallery(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((u) => typeof u === "string") : [];
  } catch {
    return [];
  }
}

const include = { category: true, author: true } as const;

/** All approved posts, newest first, rendered in `locale`. */
export async function getPosts(locale: string): Promise<PostDTO[]> {
  const rows = await prisma.post.findMany({
    where: { published: true, clearedAt: null },
    include,
    orderBy: { createdAt: "desc" },
  });
  return rows.map((r) => toDTO(r, locale));
}

/** Approved posts within a single category, rendered in `locale`. */
export async function getPostsByCategory(
  locale: string,
  category: string,
): Promise<PostDTO[]> {
  const rows = await prisma.post.findMany({
    where: {
      published: true,
      clearedAt: null,
      category: { slug: category },
    },
    include,
    orderBy: { createdAt: "desc" },
  });
  return rows.map((r) => toDTO(r, locale));
}

/** Identity of a post resolved from a URL segment. */
export type PostRef = { id: string; slug: string | null };

/**
 * Resolve a reader URL segment that may be a pretty slug (new posts) or a bare
 * cuid (legacy links shared before slugs existed). Slug is tried first; both are
 * unique indexed columns so each lookup is a fast point read. `cache()` dedupes
 * the query across `generateMetadata` and the page render within one request.
 */
export const resolvePostRef = cache(
  async (segment: string): Promise<PostRef | null> => {
    const bySlug = await prisma.post.findUnique({
      where: { slug: segment },
      select: { id: true, slug: true },
    });
    if (bySlug) return bySlug;
    const byId = await prisma.post.findUnique({
      where: { id: segment },
      select: { id: true, slug: true },
    });
    return byId;
  },
);

/** A single post (any state) by id, rendered in `locale` when provided. */
export async function getPostById(
  id: string,
  locale?: string,
): Promise<PostDTO | null> {
  const row = await prisma.post.findUnique({ where: { id }, include });
  return row ? toDTO(row, locale) : null;
}

/** Count one more view and return the post with the fresh count baked in. */
export async function recordView(
  id: string,
  locale?: string,
): Promise<PostDTO | null> {
  // updateMany is a no-op (count: 0) for a since-deleted post instead of
  // throwing P2025 like update() — which Prisma logs as a spurious
  // `prisma:error` before we could catch it. Bumping the view of a post the
  // 24h cleanup already purged is harmless, so we don't care about the count.
  await prisma.post.updateMany({
    where: { id },
    data: { views: { increment: 1 } },
  });
  return getPostById(id, locale);
}

/**
 * Recommended posts for an article: same category first, then the newest
 * from other sections, so the block is always filled. Excludes the article
 * itself.
 */
export async function getRelatedPosts(
  locale: string,
  post: PostDTO,
  limit = 4,
): Promise<PostDTO[]> {
  const rows = await prisma.post.findMany({
    where: { published: true, clearedAt: null, id: { not: post.id } },
    include,
    orderBy: { createdAt: "desc" },
    take: 60,
  });
  const all = rows.map((r) => toDTO(r, locale));
  const sameCat = all.filter((p) => p.category === post.category);
  const others = all.filter((p) => p.category !== post.category);
  return [...sameCat, ...others].slice(0, limit);
}

/** Every post for the admin dashboard (original text, all states). */
export async function getAllPostsAdmin(): Promise<PostDTO[]> {
  const rows = await prisma.post.findMany({
    include,
    orderBy: { createdAt: "desc" },
  });
  return rows.map((r) => toDTO(r));
}

/**
 * Minimal public-post list for the XML sitemap: just the slug (id fallback) and
 * last-modified time, for every published, non-cleared post. Selects only two
 * columns so building the sitemap never loads article bodies.
 */
export async function getSitemapPosts(): Promise<
  { slug: string; updatedAt: Date }[]
> {
  const rows = await prisma.post.findMany({
    where: { published: true, clearedAt: null },
    select: { id: true, slug: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
  });
  return rows.map((r) => ({ slug: r.slug ?? r.id, updatedAt: r.updatedAt }));
}

/** Live vs cleared (soft-deleted) post counts for the admin Clear/Restore UI. */
export async function getContentCounts(): Promise<{
  live: number;
  cleared: number;
}> {
  const [live, cleared] = await Promise.all([
    prisma.post.count({ where: { clearedAt: null } }),
    prisma.post.count({ where: { clearedAt: { not: null } } }),
  ]);
  return { live, cleared };
}
