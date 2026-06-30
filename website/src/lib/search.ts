// Clever search: relevance ranking, typo-tolerant term suggestions, live
// recommendations (articles + sections + completions + trending).
//
// Everything is locale-aware: posts are matched on their translated title/excerpt
// for the reader's language, and theme suggestions use localized labels.
import { prisma } from "./prisma";
import { getActiveThemes } from "./themes";
import type { PostDTO } from "./posts";

// ── Text utils ───────────────────────────────────────────────────────────────

/** Lowercase + strip diacritics so "Erdoğan" matches "erdogan". */
function fold(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "");
}

function tokenize(s: string): string[] {
  return fold(s)
    .split(/[^a-z0-9Ѐ-ӿ]+/)
    .filter((w) => w.length >= 2);
}

/** Bounded Levenshtein (early-exit at maxDistance) for typo tolerance. */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      cur[j] = v;
      if (v < best) best = v;
    }
    if (best > max) return max + 1; // whole row exceeds budget → bail
    prev = cur;
  }
  return prev[b.length];
}

// ── Light post index (no body — keeps per-keystroke suggest fast) ─────────────

export type SearchCard = {
  id: string;
  title: string;
  excerpt: string;
  category: string;
  categoryName: string;
  imageUrl: string | null;
  views: number;
};

type Lite = SearchCard & { createdAt: number };

function labelFor(labels: string | null, slug: string, locale: string): string {
  if (labels) {
    try {
      const m = JSON.parse(labels) as Record<string, string>;
      if (m?.[locale]) return m[locale];
    } catch {
      /* slug fallback */
    }
  }
  return slug;
}

function pickLocale(translations: string | null, locale: string) {
  if (!translations) return null;
  try {
    return (JSON.parse(translations) as Record<string, { title: string; excerpt: string }>)[locale] ?? null;
  } catch {
    return null;
  }
}

async function loadLite(locale: string): Promise<Lite[]> {
  const rows = await prisma.post.findMany({
    where: { published: true, clearedAt: null },
    select: {
      id: true,
      title: true,
      excerpt: true,
      translations: true,
      views: true,
      imageUrl: true,
      createdAt: true,
      category: { select: { slug: true, labels: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((r) => {
    const tr = pickLocale(r.translations, locale);
    return {
      id: r.id,
      title: tr?.title || r.title,
      excerpt: tr?.excerpt || r.excerpt,
      category: r.category.slug,
      categoryName: labelFor(r.category.labels, r.category.slug, locale),
      imageUrl: r.imageUrl,
      views: r.views,
      createdAt: r.createdAt.getTime(),
    };
  });
}

// ── Relevance scoring ────────────────────────────────────────────────────────

const DAY = 86_400_000;

/**
 * Relevance score for one item against a folded query + its tokens. Combines
 * phrase position (title prefix > word-start > substring > excerpt), per-token
 * coverage with typo tolerance, a small recency nudge and a popularity nudge.
 * Returns 0 when nothing meaningful matches.
 */
function scoreItem(
  it: { title: string; excerpt: string; views: number; createdAt: number },
  qFolded: string,
  qTokens: string[],
  now: number,
): number {
  const title = fold(it.title);
  const excerpt = fold(it.excerpt);
  let score = 0;

  // Whole-phrase matches in the title are the strongest signal.
  if (qFolded.length >= 2) {
    if (title.startsWith(qFolded)) score += 120;
    else if (new RegExp(`\\b${escapeRe(qFolded)}`).test(title)) score += 80;
    else if (title.includes(qFolded)) score += 50;
    if (excerpt.includes(qFolded)) score += 18;
  }

  // Per-token coverage (handles multi-word queries + typos).
  const titleWords = title.split(/[^a-z0-9Ѐ-ӿ]+/).filter(Boolean);
  let matchedTokens = 0;
  for (const tok of qTokens) {
    if (title.includes(tok)) {
      score += 14;
      matchedTokens++;
    } else if (excerpt.includes(tok)) {
      score += 6;
      matchedTokens++;
    } else if (tok.length >= 4) {
      // typo tolerance against title words
      const fuzzy = titleWords.some((w) => editDistance(w, tok, 1) <= 1);
      if (fuzzy) {
        score += 8;
        matchedTokens++;
      }
    }
  }
  if (score === 0) return 0;

  // Require most tokens to match for multi-word queries (avoids noise).
  if (qTokens.length > 1 && matchedTokens / qTokens.length < 0.5) return 0;

  // Popularity + recency nudges (never dominate textual relevance).
  score += Math.min(15, Math.log2(it.views + 1) * 2);
  const ageDays = (now - it.createdAt) / DAY;
  if (ageDays < 2) score += 6;
  else if (ageDays < 7) score += 3;

  return score;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ── Term completions ("clever" autocomplete + did-you-mean) ──────────────────

const STOP = new Set([
  "the", "and", "for", "with", "from", "that", "this", "are", "was", "has",
  "его", "как", "что", "для", "при", "был", "это", "uchun", "bilan", "ham",
]);

/** Suggest short query completions derived from the matching titles. */
function deriveTerms(titles: string[], qFolded: string): string[] {
  const freq = new Map<string, { display: string; n: number; starts: boolean }>();
  for (const title of titles) {
    const words = title.split(/[^A-Za-z0-9Ѐ-ӿ]+/).filter(Boolean);
    for (const w of words) {
      const f = fold(w);
      if (f.length < 3 || STOP.has(f)) continue;
      if (!f.includes(qFolded)) continue;
      const cur = freq.get(f);
      if (cur) cur.n++;
      else freq.set(f, { display: w, n: 1, starts: f.startsWith(qFolded) });
    }
  }
  return [...freq.values()]
    .sort((a, b) => Number(b.starts) - Number(a.starts) || b.n - a.n)
    .slice(0, 5)
    .map((x) => x.display);
}

/** Closest single word across all titles — used for "did you mean" on misses. */
function didYouMean(allTitles: string[], qFolded: string): string | null {
  if (qFolded.length < 4) return null;
  let best: { word: string; d: number } | null = null;
  for (const title of allTitles) {
    for (const w of title.split(/[^A-Za-z0-9Ѐ-ӿ]+/)) {
      const f = fold(w);
      if (f.length < 4 || STOP.has(f)) continue;
      const d = editDistance(f, qFolded, 2);
      if (d <= 2 && (!best || d < best.d)) best = { word: w, d };
    }
  }
  return best && best.d > 0 ? best.word : null;
}

// ── Public API ───────────────────────────────────────────────────────────────

export type Suggestions = {
  query: string;
  terms: string[];
  themes: { slug: string; name: string }[];
  articles: SearchCard[];
  trending: SearchCard[];
  didYouMean: string | null;
};

const toCard = (it: Lite): SearchCard => ({
  id: it.id,
  title: it.title,
  excerpt: it.excerpt,
  category: it.category,
  categoryName: it.categoryName,
  imageUrl: it.imageUrl,
  views: it.views,
});

/** Live recommendations for the search box. Empty query → trending + sections. */
export async function suggest(locale: string, qRaw: string): Promise<Suggestions> {
  const q = qRaw.trim();
  const [items, allThemes] = await Promise.all([
    loadLite(locale),
    getActiveThemes(locale),
  ]);

  if (!q) {
    const trending = [...items].sort((a, b) => b.views - a.views).slice(0, 6).map(toCard);
    return {
      query: "",
      terms: [],
      themes: allThemes.slice(0, 8).map((t) => ({ slug: t.slug, name: t.name })),
      articles: [],
      trending,
      didYouMean: null,
    };
  }

  const qFolded = fold(q);
  const qTokens = tokenize(q);
  const ref = Date.now();
  const scored = items
    .map((it) => ({ it, s: scoreItem(it, qFolded, qTokens, ref) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s);

  const articles = scored.slice(0, 6).map((x) => toCard(x.it));
  const terms = deriveTerms(scored.map((x) => x.it.title), qFolded);
  const themes = allThemes
    .filter((t) => fold(t.name).includes(qFolded) || t.slug.includes(qFolded))
    .slice(0, 4)
    .map((t) => ({ slug: t.slug, name: t.name }));
  const dym = scored.length === 0 ? didYouMean(items.map((i) => i.title), qFolded) : null;

  return { query: qRaw, terms, themes, articles, trending: [], didYouMean: dym };
}

/** Ranked full-text results for the /search page (operates on full DTOs). */
export function rankPosts(posts: PostDTO[], qRaw: string): PostDTO[] {
  const q = qRaw.trim();
  if (!q) return [];
  const qFolded = fold(q);
  const qTokens = tokenize(q);
  const now = Date.now();
  return posts
    .map((p) => ({
      p,
      s: scoreItem(
        {
          title: `${p.title} ${p.categoryName}`,
          excerpt: `${p.excerpt} ${p.body}`,
          views: p.views,
          createdAt: new Date(p.createdAt).getTime(),
        },
        qFolded,
        qTokens,
        now,
      ),
    }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.p);
}

/** A "did you mean" suggestion for the results page when a query has no hits. */
export function suggestSpelling(posts: PostDTO[], qRaw: string): string | null {
  return didYouMean(posts.map((p) => p.title), fold(qRaw.trim()));
}

/**
 * All posts that belong in a theme's section: the ones explicitly assigned to it
 * PLUS every post whose content is relevant to the filter's topic. This makes a
 * story show under every filter it relates to (not just its primary one), and a
 * newly added filter immediately surfaces existing related news.
 *
 * Order: assigned posts first (newest-first, as given), then relevance-ranked
 * matches, de-duplicated.
 */
export function postsForTheme(
  posts: PostDTO[],
  theme: { slug: string; name: string },
): PostDTO[] {
  // Significant tokens of the filter name (drop stopwords).
  const tokens = [...new Set(tokenize(theme.name).filter((t) => !STOP.has(t)))];
  // How many must co-occur: 1-word → 1, otherwise at least 2 (keeps multi-word
  // filters precise — "Global Economics" needs both, not just "global").
  const needed = Math.min(2, tokens.length);

  const out: PostDTO[] = [];
  for (const p of posts) {
    // posts arrive newest-first
    if (p.category === theme.slug) {
      out.push(p);
      continue;
    }
    if (tokens.length === 0) continue;
    const hay = fold(`${p.title} ${p.categoryName} ${p.excerpt} ${p.body}`);
    const words = hay.split(/[^a-z0-9Ѐ-ӿ]+/).filter(Boolean);
    let hitCount = 0;
    for (const tok of tokens) {
      const present =
        hay.includes(tok) ||
        (tok.length >= 4 && words.some((w) => editDistance(w, tok, 1) <= 1));
      if (present) hitCount++;
      if (hitCount >= needed) break;
    }
    if (hitCount >= needed) out.push(p);
  }
  return out;
}
