import { prisma } from "./prisma";
import type { CategorySlug } from "./constants";
import type { Translations } from "./translate";

// Shape consumed by the UI (category flattened to its slug).
export type PostDTO = {
  id: string;
  title: string;
  excerpt: string;
  body: string;
  imageUrl: string | null;
  language: string;
  category: CategorySlug;
  breaking: boolean;
  published: boolean;
  views: number;
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
  createdAt: Date;
  category: { slug: string };
  author: { name: string | null } | null;
};

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
    category: p.category.slug as CategorySlug,
    breaking: p.breaking,
    published: p.published,
    views: p.views,
    author: p.author?.name ?? null,
    createdAt: p.createdAt.toISOString(),
  };
}

const include = { category: true, author: true } as const;

/** All approved posts, newest first, rendered in `locale`. */
export async function getPosts(locale: string): Promise<PostDTO[]> {
  const rows = await prisma.post.findMany({
    where: { published: true },
    include,
    orderBy: { createdAt: "desc" },
  });
  return rows.map((r) => toDTO(r, locale));
}

/** Approved posts within a single category, rendered in `locale`. */
export async function getPostsByCategory(
  locale: string,
  category: CategorySlug,
): Promise<PostDTO[]> {
  const rows = await prisma.post.findMany({
    where: {
      published: true,
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
    where: { published: true, id: { not: post.id } },
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
