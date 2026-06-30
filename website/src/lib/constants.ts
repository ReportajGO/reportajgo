// Shared, framework-agnostic constants.
//
// Themes (a.k.a. categories/sections) are dynamic — they are synced from the
// agent's topic filters into the Category table. The list below is only a set
// of legacy defaults + brand styling overrides for well-known slugs; the live
// nav, homepage bands and theme pages are all DB-driven (see lib/themes.ts).

export const CATEGORIES = [
  "world",
  "economics",
  "sport",
  "culture",
  "tech",
] as const;

// Category slugs are free-form now (any topic the operator adds), so the slug
// type is just a string. Kept as a named alias so existing imports still work.
export type CategorySlug = string;

// Brand color overrides for known slugs — used by cover tiles. Unknown slugs
// get a deterministic color derived from the slug (see colorFor).
const CAT_COLOR_OVERRIDES: Record<string, string> = {
  world: "#1f44ff",
  economics: "#0c8f6e",
  sport: "#E51A24",
  culture: "#8b3df0",
  tech: "#0f7bbd",
};

// Watermark word overrides for known slugs (see wordFor for the fallback).
const CAT_WORD_OVERRIDES: Record<string, string> = {
  world: "WORLD",
  economics: "ECON",
  sport: "SPORT",
  culture: "KULT",
  tech: "TECH",
};

/** Deterministic, pleasant brand color for any slug (override-aware). */
export function colorFor(slug: string): string {
  const known = CAT_COLOR_OVERRIDES[slug];
  if (known) return known;
  // Hash the slug into a hue; fixed saturation/lightness keeps it on-brand.
  let h = 0;
  for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) % 360;
  return hslToHex(h, 62, 45);
}

/** Watermark word baked into generated cover tiles (override-aware). */
export function wordFor(slug: string): string {
  const known = CAT_WORD_OVERRIDES[slug];
  if (known) return known;
  // First token of the slug, uppercased, capped so it fits the tile.
  return slug.split(/[-_\s]/)[0].slice(0, 6).toUpperCase() || "NEWS";
}

function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const c = l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return Math.round(255 * c)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/** A usable theme slug: any non-empty string. (Themes are dynamic now.) */
export function isCategory(value: unknown): value is CategorySlug {
  return typeof value === "string" && value.trim().length > 0;
}

// Cover aspect ratios the admin can choose, with their CSS aspect-ratio value.
export const ASPECTS = ["16:9", "1:1", "4:5"] as const;
export type AspectRatio = (typeof ASPECTS)[number];
export const ASPECT_CSS: Record<AspectRatio, string> = {
  "16:9": "16 / 9",
  "1:1": "1 / 1",
  "4:5": "4 / 5",
};
export function isAspect(value: string): value is AspectRatio {
  return (ASPECTS as readonly string[]).includes(value);
}
