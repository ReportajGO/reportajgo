// URL slugs for posts.
//
// Posts used to be addressed by their random cuid (e.g. /article/clx8f…), which
// is opaque and hurts search-engine indexing. We derive a human- and SEO-
// friendly slug from the headline instead ("The Next Kubernetes Is Already
// Here." → "the-next-kubernetes-is-already-here"), transliterating Uzbek/Russian
// Cyrillic and Uzbek-Latin apostrophe letters so multilingual titles stay
// readable and URL-safe.
//
// This is the single source of truth for slug shape. `scripts/backfill-slugs.ts`
// reuses `slugify` from here, so existing posts get the exact same slugs as new
// ones. Keep it dependency-free (imported by API routes, the reader page, and a
// standalone tsx script alike).

// Cyrillic (Russian + Uzbek) → Latin. Uzbek-Latin conventions are preferred
// where they differ from Russian romanization (х→x, ж→j) since the site's
// primary audience reads Uzbek. Keys are lowercase; input is lowercased first.
const CYRILLIC_TO_LATIN: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "j", з: "z",
  и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
  с: "s", т: "t", у: "u", ф: "f", х: "x", ц: "ts", ч: "ch", ш: "sh", щ: "sh",
  ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
  // Uzbek Cyrillic extensions.
  ў: "o", қ: "q", ғ: "g", ҳ: "h",
};

// Latin letters that do NOT decompose under NFKD but still need romanizing.
const LATIN_EXTRAS: Record<string, string> = {
  ß: "ss", æ: "ae", œ: "oe", ø: "o", đ: "d", ð: "d", þ: "th", ł: "l", ħ: "h",
  ı: "i", ĸ: "k", ŋ: "ng",
};

// Uzbek-Latin modifier apostrophes and typographic quotes. Stripping them turns
// oʻzbekiston → ozbekiston and gʻalaba → galaba.
const APOSTROPHES = /[ʻʼ‘’′'`´]/g;

const MAX_SLUG_LENGTH = 80;
const FALLBACK_SLUG = "post";

/**
 * Turn a headline into a lowercase, hyphenated, ASCII slug. Deterministic and
 * side-effect free. Never returns an empty string (falls back to "post"), so a
 * title made entirely of emoji or unsupported scripts still yields a base that
 * the uniqueness layer can suffix.
 */
export function slugify(input: string): string {
  const transliterated = Array.from(input.replace(APOSTROPHES, "").toLowerCase())
    .map((ch) => CYRILLIC_TO_LATIN[ch] ?? LATIN_EXTRAS[ch] ?? ch)
    .join("");

  let slug = transliterated
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip combining diacritics (é→e, ñ→n…)
    .replace(/[^a-z0-9]+/g, "-") // everything else → hyphen
    .replace(/^-+|-+$/g, ""); // trim leading/trailing hyphens

  if (slug.length > MAX_SLUG_LENGTH) {
    const cut = slug.slice(0, MAX_SLUG_LENGTH);
    const lastHyphen = cut.lastIndexOf("-");
    // Prefer a whole-word cut; only fall back to a hard cut for a single long token.
    slug = (lastHyphen > 0 ? cut.slice(0, lastHyphen) : cut).replace(/-+$/g, "");
  }

  return slug || FALLBACK_SLUG;
}

/**
 * Given a base slug and a predicate that reports whether a candidate is already
 * taken, return the base if free, otherwise "base-2", "base-3", … — the first
 * available numeric suffix. The predicate is awaited so it can hit the database.
 */
export async function buildUniqueSlug(
  base: string,
  isTaken: (candidate: string) => Promise<boolean>,
): Promise<string> {
  if (!(await isTaken(base))) return base;
  // Bounded to avoid an unbounded loop under pathological collisions; the cap is
  // far beyond any realistic number of same-titled posts.
  for (let n = 2; n <= 10_000; n++) {
    const candidate = `${base}-${n}`;
    if (!(await isTaken(candidate))) return candidate;
  }
  throw new Error(`Could not derive a unique slug for "${base}"`);
}
