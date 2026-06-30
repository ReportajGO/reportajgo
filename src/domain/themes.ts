// Topic → theme-slug mapping.
//
// The agent is the single source of truth for theme slugs: it derives a stable,
// deterministic slug from a topic name and sends that slug BOTH when syncing the
// website's themes and when publishing an article. That way the website never
// has to re-derive a slug and the two sides can't disagree.

/**
 * Deterministic URL slug for a topic name. Latin topics become readable slugs
 * ("Artificial Intelligence" → "artificial-intelligence"); non-Latin topics
 * (e.g. Cyrillic) fall back to a stable short hash so the slug is still unique
 * and matchable. The human-facing label is localized separately on the website.
 */
export function themeSlug(topic: string): string {
  const base = topic
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip combining diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (base) return base.slice(0, 40);

  // No Latin characters survived (e.g. a Cyrillic topic) → stable hash slug.
  let h = 0;
  for (let i = 0; i < topic.length; i++) h = (h * 31 + topic.charCodeAt(i)) >>> 0;
  return `theme-${h.toString(36)}`;
}
