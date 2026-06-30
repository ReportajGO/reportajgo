// Theme (category/section) read layer. Themes are DB-driven — each one mirrors
// a topic filter the operator added in the agent (synced via /api/agent/themes).
// Used by the nav, homepage bands and the /[locale]/[slug] theme pages.
import { prisma } from "./prisma";
import { colorFor, wordFor } from "./constants";

export type Theme = {
  slug: string;
  name: string; // localized label (falls back to the slug)
  color: string;
  word: string;
};

function labelFor(labels: string | null, slug: string, locale: string): string {
  if (labels) {
    try {
      const map = JSON.parse(labels) as Record<string, string>;
      if (map?.[locale]) return map[locale];
    } catch {
      /* fall through to slug */
    }
  }
  return slug;
}

type CategoryRow = {
  slug: string;
  labels: string | null;
  color: string | null;
  word: string | null;
};

function toTheme(r: CategoryRow, locale: string): Theme {
  return {
    slug: r.slug,
    name: labelFor(r.labels, r.slug, locale),
    color: r.color ?? colorFor(r.slug),
    word: r.word ?? wordFor(r.slug),
  };
}

/** All active themes in nav order, localized for `locale`. */
export async function getActiveThemes(locale: string): Promise<Theme[]> {
  const rows = await prisma.category.findMany({
    where: { active: true },
    orderBy: [{ order: "asc" }, { slug: "asc" }],
  });
  return rows.map((r) => toTheme(r, locale));
}

export type ThemeStat = {
  slug: string;
  name: string;
  labels: { uz: string; ru: string; en: string };
  active: boolean;
  count: number; // live posts primarily assigned to this section
};

/** All themes (active + hidden) with their assigned live-post counts, for admin. */
export async function getThemeStats(locale: string): Promise<ThemeStat[]> {
  const [cats, grouped] = await Promise.all([
    prisma.category.findMany({ orderBy: [{ active: "desc" }, { order: "asc" }] }),
    prisma.post.groupBy({
      by: ["categoryId"],
      where: { clearedAt: null },
      _count: { _all: true },
    }),
  ]);
  const counts = new Map(grouped.map((g) => [g.categoryId, g._count._all]));
  return cats.map((c) => {
    let labels = { uz: c.slug, ru: c.slug, en: c.slug };
    if (c.labels) {
      try {
        const m = JSON.parse(c.labels) as Record<string, string>;
        labels = { uz: m.uz ?? c.slug, ru: m.ru ?? c.slug, en: m.en ?? c.slug };
      } catch {
        /* slug fallback */
      }
    }
    return {
      slug: c.slug,
      name: labelFor(c.labels, c.slug, locale),
      labels,
      active: c.active,
      count: counts.get(c.id) ?? 0,
    };
  });
}

/** A single active theme by slug, or null if missing/hidden. */
export async function getThemeBySlug(
  slug: string,
  locale: string,
): Promise<Theme | null> {
  const r = await prisma.category.findUnique({ where: { slug } });
  if (!r || !r.active) return null;
  return toTheme(r, locale);
}
