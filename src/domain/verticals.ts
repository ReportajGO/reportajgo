// The seven content verticals and their fixed editorial shares.
//
// Source of truth: TZ §5.1 (asosiy mavzular), §5.2 (tavsiya etiladigan mavzular
// ulushi) and §13.1 (haftalik namunaviy ritm).
//
// This replaces the old free-text RESEARCH_TOPICS list. Topics are no longer an
// arbitrary operator string — they are seven fixed verticals with target shares
// that must sum to 100%. The pipeline uses the shares to keep the published mix
// on-strategy instead of letting whichever vertical happens to produce the most
// candidates dominate the feed.

import type { Vertical } from "./types.js";

export interface VerticalSpec {
  id: Vertical;
  /** Vertical name as used in the concept document (Uzbek). */
  name: string;
  /** English label, for logs and dashboards. */
  nameEn: string;
  /** Target share of all published material, as a percentage (TZ §5.2). */
  targetShare: number;
  /** Editorial note from TZ §5.2 explaining why the vertical exists. */
  rationale: string;
  /** Subject matter to search for, fed into the research prompt (TZ §5.1). */
  scope: string;
}

export const VERTICALS: readonly VerticalSpec[] = [
  {
    id: "ECONOMY",
    name: "Iqtisod va investitsiya",
    nameEn: "Economy & investment",
    targetShare: 25,
    rationale: "Primary strategic direction.",
    scope:
      "markets, industry, trade, infrastructure, energy, logistics, the business " +
      "climate and concrete investment opportunities",
  },
  {
    id: "INNOVATION",
    name: "Kashfiyot va innovatsiya",
    nameEn: "Discovery & innovation",
    targetShare: 15,
    rationale: "Technological news.",
    scope:
      "new technologies, patents, engineering solutions, artificial intelligence, " +
      "robotics and green technology",
  },
  {
    id: "SCIENCE",
    name: "Ilm-fan va ta'lim",
    nameEn: "Science & education",
    targetShare: 15,
    rationale: "Knowledge and expertise.",
    scope:
      "research, universities, laboratories, scientists, teaching methods and " +
      "published scientific results",
  },
  {
    id: "STARTUP",
    name: "Startap va tadbirkorlik",
    nameEn: "Startups & entrepreneurship",
    targetShare: 15,
    rationale: "Business protagonists and models.",
    scope:
      "founder stories, business models, fundraising, products and real market " +
      "experience",
  },
  {
    id: "PEOPLE",
    name: "Yoshlar va ayollar",
    nameEn: "Youth & women",
    targetShare: 15,
    rationale: "Motivational and opportunity content.",
    scope:
      "motivational stories, leadership, careers, education, entrepreneurship and " +
      "examples of social mobility, focused on young people and women",
  },
  {
    id: "FACTS",
    name: "Faktlar",
    nameEn: "Facts",
    targetShare: 8,
    rationale: "Short, fast-spreading format.",
    scope:
      "reliable, short, visual facts that leave the audience knowing something " +
      "concrete they did not know before",
  },
  {
    id: "HISTORY",
    name: "Tarixiy mavzular",
    nameEn: "History & heritage",
    targetShare: 7,
    rationale: "Cultural and scientific heritage.",
    scope:
      "civilisation, trade routes, scientific heritage, cities and the history of " +
      "development — strictly neutral material",
  },
] as const;

const BY_ID = new Map<string, VerticalSpec>(VERTICALS.map((v) => [v.id, v]));

/** Sum of all target shares. Asserted by tests to equal 100. */
export const TOTAL_TARGET_SHARE = VERTICALS.reduce((sum, v) => sum + v.targetShare, 0);

export function findVertical(id: string): VerticalSpec | undefined {
  return BY_ID.get(id.toUpperCase());
}

export function verticalOf(id: string): VerticalSpec {
  const spec = findVertical(id);
  if (!spec) throw new Error(`unknown vertical: ${id}`);
  return spec;
}

export function isVertical(id: unknown): id is Vertical {
  return typeof id === "string" && BY_ID.has(id.toUpperCase());
}

export function allVerticalIds(): Vertical[] {
  return VERTICALS.map((v) => v.id);
}

/**
 * The weekly publication rhythm (TZ §13.1). Index 0 = Sunday, matching
 * `Date.prototype.getDay()`.
 *
 * Thursday is the Uzbekistan-opportunities / international-cooperation day,
 * which is why it maps to ECONOMY here while also being the natural anchor for
 * the 20% Uzbekistan quota — see `domain/quota.ts`.
 */
const WEEKLY_RHYTHM: readonly Vertical[] = [
  "HISTORY", // Sunday    — tarixiy, madaniy yoki ilhomlantiruvchi material
  "ECONOMY", // Monday    — iqtisod va investitsiya
  "SCIENCE", // Tuesday   — ilm-fan va kashfiyot
  "STARTUP", // Wednesday — startap va tadbirkor
  "ECONOMY", // Thursday  — O'zbekiston imkoniyatlari / xalqaro hamkorlik
  "PEOPLE", // Friday    — yoshlar va ayollar muvaffaqiyati
  "FACTS", // Saturday  — faktlar va qisqa video
] as const;

/** The vertical this weekday leads with, per the TZ weekly rhythm. */
export function verticalForDay(date: Date): Vertical {
  return WEEKLY_RHYTHM[date.getDay()]!;
}

/**
 * True when this weekday is the Uzbekistan-focused day (Thursday, TZ §13.1).
 * The quota is monthly, not daily, so this only biases day-to-day topic
 * selection — it never relaxes or tightens the monthly 20% ±2% requirement.
 */
export function isUzbekistanDay(date: Date): boolean {
  return date.getDay() === 4;
}

/**
 * Pick the verticals a run should research, ordered by how far each one is
 * BELOW its target share in the recent published mix. This is what keeps the
 * feed on-strategy: a vertical that is already over-represented yields its slot
 * to one that is under-served.
 *
 * @param recentCounts  How many items each vertical contributed recently.
 * @param slots         How many verticals to research this run.
 * @param leadVertical  The weekday's vertical, always placed first (TZ §13.1).
 */
export function verticalsForRun(
  recentCounts: Readonly<Partial<Record<Vertical, number>>>,
  slots: number,
  leadVertical?: Vertical,
): Vertical[] {
  if (slots <= 0) return [];

  const total = VERTICALS.reduce((sum, v) => sum + (recentCounts[v.id] ?? 0), 0);

  // Deficit = target share minus actual share. Positive = under-served. With no
  // history at all every vertical sits at its full target, so the natural order
  // is simply share-descending (ECONOMY first) — which is the intended default.
  const ranked = [...VERTICALS]
    .map((v) => {
      const actualShare = total > 0 ? ((recentCounts[v.id] ?? 0) / total) * 100 : 0;
      return { id: v.id, deficit: v.targetShare - actualShare };
    })
    .sort((a, b) => b.deficit - a.deficit)
    .map((v) => v.id);

  // The weekday's lead vertical goes first regardless of deficit, then the rest
  // fill remaining slots in deficit order.
  const ordered = leadVertical
    ? [leadVertical, ...ranked.filter((id) => id !== leadVertical)]
    : ranked;

  return ordered.slice(0, Math.min(slots, ordered.length));
}

/**
 * Current published mix vs. target, for the editorial dashboard (TZ §15/§16).
 * `drift` is percentage points off target: positive = over-published.
 */
export function mixReport(
  counts: Readonly<Partial<Record<Vertical, number>>>,
): { vertical: Vertical; target: number; actual: number; drift: number }[] {
  const total = VERTICALS.reduce((sum, v) => sum + (counts[v.id] ?? 0), 0);
  return VERTICALS.map((v) => {
    const actual = total > 0 ? ((counts[v.id] ?? 0) / total) * 100 : 0;
    return {
      vertical: v.id,
      target: v.targetShare,
      actual: Number(actual.toFixed(1)),
      drift: Number((actual - v.targetShare).toFixed(1)),
    };
  });
}
