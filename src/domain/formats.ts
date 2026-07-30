// Content formats and the target format mix.
//
// Source of truth: TZ §7 (kontent formatlari va ishlab chiqarish standarti),
// §7.1 (tavsiya etiladigan format ulushi), §12 (vizual va video talablari).
//
// The old pipeline had one implicit format per platform (an image + a caption).
// The new strategy is video-first: 60% of everything published must be short or
// explainer video. This file is the production spec each draft is generated
// against, and the mix the pipeline balances toward.

import type { AspectRatio, ContentFormat, MediaType } from "./types.js";

export interface FormatSpec {
  id: ContentFormat;
  name: string;
  /** Share of the total published mix, in percent (TZ §7.1). */
  targetShare: number;
  /** Media the format produces. */
  media: { type: MediaType; aspectRatio: AspectRatio } | null;
  /** Duration bounds in seconds, for video formats. */
  durationSec?: { min: number; max: number };
  /** Body length bounds in words, for text formats. */
  words?: { min: number; max: number };
  /** Production requirements fed into the generation prompt (TZ §7). */
  spec: string;
}

export const FORMATS: readonly FormatSpec[] = [
  {
    id: "SHORT_VIDEO",
    name: "Qisqa vertikal video",
    targetShare: 35,
    media: { type: "VIDEO", aspectRatio: "9:16" },
    durationSec: { min: 15, max: 45 },
    spec:
      "15-45 seconds, 9:16. The first 2 seconds must carry the whole hook. " +
      "Subtitles are mandatory. Exactly ONE main idea — no second theme.",
  },
  {
    id: "EXPLAINER_VIDEO",
    name: "Izohli video",
    targetShare: 25,
    media: { type: "VIDEO", aspectRatio: "9:16" },
    durationSec: { min: 60, max: 120 },
    spec:
      "60-120 seconds, 9:16 or 16:9. Exactly 3-5 core facts, then a short " +
      "conclusion and a call to action. Subtitles mandatory.",
  },
  {
    id: "TEXT_POST",
    name: "Matnli post",
    targetShare: 15,
    media: { type: "IMAGE", aspectRatio: "4:5" },
    words: { min: 80, max: 180 },
    spec:
      "80-180 words: headline, the core fact, a short explanation, the source, " +
      "and a call to action.",
  },
  {
    id: "CAROUSEL",
    name: "Karusel",
    targetShare: 10,
    media: { type: "IMAGE", aspectRatio: "4:5" },
    spec:
      "5-8 slides. Slide 1 is the promise, the middle slides carry the facts, " +
      "the last slide is the conclusion or the action.",
  },
  {
    id: "MINI_REPORTAGE",
    name: "Mini-reportaj",
    targetShare: 7,
    media: { type: "VIDEO", aspectRatio: "16:9" },
    durationSec: { min: 180, max: 300 },
    spec:
      "3-5 minutes. Built around a protagonist, a place, and a RESULT — never " +
      "around a problem. Show the solution and its measurable outcome.",
  },
  {
    id: "INTERVIEW",
    name: "Intervyu",
    targetShare: 3,
    media: { type: "VIDEO", aspectRatio: "16:9" },
    spec:
      "With an expert, investor, scientist, entrepreneur, or a woman or young " +
      "leader. Fact-checking and consent are secured in advance.",
  },
  {
    id: "ARTICLE",
    name: "Maqola",
    targetShare: 3,
    media: { type: "IMAGE", aspectRatio: "16:9" },
    words: { min: 400, max: 900 },
    spec:
      "400-900 words. SEO headline, 3-5 subsections, cited sources, and an " +
      "explicit link to why it matters for the local audience.",
  },
  {
    id: "INFOGRAPHIC",
    name: "Infografika",
    targetShare: 2,
    media: { type: "IMAGE", aspectRatio: "1:1" },
    spec:
      "One subject, at most 5 numbers. The source and the date must be shown " +
      "on the graphic itself.",
  },
] as const;

const BY_ID = new Map<string, FormatSpec>(FORMATS.map((f) => [f.id, f]));

/** Sum of format target shares. Asserted by tests to equal 100. */
export const TOTAL_FORMAT_SHARE = FORMATS.reduce((sum, f) => sum + f.targetShare, 0);

export function findFormat(id: string): FormatSpec | undefined {
  return BY_ID.get(id.toUpperCase());
}

export function formatOf(id: string): FormatSpec {
  const spec = findFormat(id);
  if (!spec) throw new Error(`unknown content format: ${id}`);
  return spec;
}

export function isContentFormat(id: unknown): id is ContentFormat {
  return typeof id === "string" && BY_ID.has(id.toUpperCase());
}

/**
 * Format-family shares from TZ §7.1, kept as an explicit assertion of intent:
 *   60% short + explainer video
 *   25% text post + carousel
 *   10% mini-reportage + interview
 *    5% infographic and special formats
 * The per-format shares above are a decomposition of exactly these families.
 */
export const FORMAT_FAMILIES: readonly { name: string; share: number; formats: ContentFormat[] }[] = [
  { name: "video", share: 60, formats: ["SHORT_VIDEO", "EXPLAINER_VIDEO"] },
  { name: "text", share: 25, formats: ["TEXT_POST", "CAROUSEL"] },
  { name: "longform", share: 10, formats: ["MINI_REPORTAGE", "INTERVIEW", "ARTICLE"] },
  { name: "special", share: 5, formats: ["INFOGRAPHIC"] },
];

/**
 * Pick the format for the next item, choosing whichever is furthest below its
 * target share in the recent mix. Keeps the network video-first by construction
 * rather than by hoping the operator remembers.
 *
 * `available` restricts the choice to formats the current media pipeline can
 * actually produce (e.g. video formats are only offered once the video engine
 * is enabled).
 */
export function nextFormat(
  recentCounts: Readonly<Partial<Record<ContentFormat, number>>>,
  available: readonly ContentFormat[] = FORMATS.map((f) => f.id),
): ContentFormat {
  const pool = FORMATS.filter((f) => available.includes(f.id));
  if (pool.length === 0) throw new Error("no content formats available");

  const total = pool.reduce((sum, f) => sum + (recentCounts[f.id] ?? 0), 0);

  let best = pool[0]!;
  let bestDeficit = -Infinity;
  for (const f of pool) {
    const actualShare = total > 0 ? ((recentCounts[f.id] ?? 0) / total) * 100 : 0;
    const deficit = f.targetShare - actualShare;
    if (deficit > bestDeficit) {
      bestDeficit = deficit;
      best = f;
    }
  }
  return best.id;
}

/** Mandatory production requirements applied to every format (TZ §12). */
export const PRODUCTION_STANDARD: readonly string[] = [
  "Subtitles are mandatory on all video, readable on a phone, inside the safe " +
    "zone, and never more than 2 lines on screen at once.",
  "No crowded text in a single frame; key numbers rendered large; the source and " +
    "date always shown.",
  "Thumbnail: one idea, a 3-7 word headline in the local language. No clickbait, " +
    "no alarm.",
  "Licensed background music only; speech clearly audible and balanced for mobile.",
  "Colour contrast, subtitles and image descriptions for accessibility.",
];

/** The production-standard block injected into generation prompts. */
export function productionPromptBlock(format: ContentFormat): string {
  const f = formatOf(format);
  return [
    `FORMAT: ${f.name}`,
    f.spec,
    ``,
    `PRODUCTION STANDARD:`,
    ...PRODUCTION_STANDARD.map((s) => `- ${s}`),
  ].join("\n");
}
