import { prisma } from "./prisma";
import type { CategorySlug } from "./constants";
import type { Translations } from "./translate";

// Shape consumed by the UI (category flattened to its slug + localized name).
export type PostDTO = {
  id: string;
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
};

type WithCategoryAuthor = {
  id: string;
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
  try {
    const row = await prisma.post.update({
      where: { id },
      data: { views: { increment: 1 } },
      include,
    });
    return toDTO(row, locale);
  } catch {
    // Post may not exist — fall back to a plain read.
    return getPostById(id, locale);
  }
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
