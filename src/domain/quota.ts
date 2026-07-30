// The Uzbekistan content quota: 20% ±2% of everything published, every month.
//
// Source of truth: TZ §5.2 ("O'ZBEKISTON KONTENTI KVOTASI"), §5.3 (priority
// directions), §15 (KPI: 20% ±2%), §22 (acceptance criteria).
//
// The rule, precisely as specified:
//   - In EVERY calendar month, 20% of all published material is Uzbekistan
//     content — positive, useful, verified.
//   - The remaining 80% is target-market and global development material.
//   - Permitted deviation: ±2 percentage points.
//
// Two things this module deliberately does NOT do:
//   1. It never lets the quota force a weak story through. The quota governs how
//      many Uzbekistan slots exist, not whether a given item deserves one — TZ
//      §5.2 states the quota is "not for praise" and §18 requires every claim to
//      rest on verified fact. An under-filled quota is an editorial signal to
//      commission better Uzbekistan material, not a licence to publish filler.
//   2. It never counts a partial month as a failure. Mid-month the actual share
//      swings wildly on small denominators, so `assess` reports drift without a
//      verdict until the month has enough volume to be meaningful.

import type { QuotaAssessment, QuotaVerdict } from "./types.js";

/** Target share of Uzbekistan content, in percent. */
export const UZ_QUOTA_TARGET = 20;

/** Permitted deviation from the target, in percentage points. */
export const UZ_QUOTA_TOLERANCE = 2;

/**
 * Below this many published items in the period, the share is too noisy to
 * judge — with 4 items published, one Uzbekistan post is already 25%. Chosen so
 * that a single item moves the share by at most ~5 points.
 */
export const QUOTA_MIN_SAMPLE = 20;

/** The priority directions for the 20% (TZ §5.3), used in the research prompt. */
export const UZ_PRIORITY_DIRECTIONS: readonly string[] = [
  "Investment opportunities, free economic zones, industrial projects and infrastructure.",
  "Uzbek startups, technology companies, exporters and young entrepreneurs.",
  "Science, higher education, the heritage of historical scholars, and modern research.",
  "Success of women and young people, vocational education, employment and social mobility.",
  "Tourism, gastronomy, craftsmanship, cultural heritage and modern cities.",
  "Green energy, agritechnology, logistics, and links connecting Central Asia.",
  "The positive experience of international companies, investors and institutions in Uzbekistan.",
];

/** Inclusive bounds of the acceptable share, in percent. */
export const UZ_QUOTA_BOUNDS = {
  min: UZ_QUOTA_TARGET - UZ_QUOTA_TOLERANCE,
  max: UZ_QUOTA_TARGET + UZ_QUOTA_TOLERANCE,
} as const;

/** First instant of the calendar month containing `date`, in UTC. */
export function monthStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

/** First instant of the month AFTER the one containing `date`, in UTC. */
export function monthEnd(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
}

/** Stable "YYYY-MM" key for the calendar month, used for grouping and logs. */
export function monthKey(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/**
 * Assess the current month's Uzbekistan share.
 *
 * @param uzCount     Uzbekistan-quota items published so far this month.
 * @param totalCount  All items published so far this month (including the above).
 */
export function assess(uzCount: number, totalCount: number): QuotaAssessment {
  if (uzCount < 0 || totalCount < 0) {
    throw new Error("quota counts cannot be negative");
  }
  if (uzCount > totalCount) {
    throw new Error(`uzCount (${uzCount}) cannot exceed totalCount (${totalCount})`);
  }

  const share = totalCount > 0 ? (uzCount / totalCount) * 100 : 0;
  const drift = share - UZ_QUOTA_TARGET;

  let verdict: QuotaVerdict;
  if (totalCount < QUOTA_MIN_SAMPLE) {
    verdict = "UNDETERMINED";
  } else if (share < UZ_QUOTA_BOUNDS.min) {
    verdict = "UNDER";
  } else if (share > UZ_QUOTA_BOUNDS.max) {
    verdict = "OVER";
  } else {
    verdict = "ON_TARGET";
  }

  return {
    uzCount,
    totalCount,
    share: Number(share.toFixed(1)),
    drift: Number(drift.toFixed(1)),
    verdict,
    target: UZ_QUOTA_TARGET,
    tolerance: UZ_QUOTA_TOLERANCE,
  };
}

/**
 * How many of the next `slots` items should be Uzbekistan content to steer the
 * month's share back to 20%.
 *
 * Returns a count in [0, slots]. The maths: after publishing `slots` more items
 * of which `k` are Uzbekistan content, the share becomes
 * (uzCount + k) / (totalCount + slots). Solve for the k that lands on target,
 * then clamp and round.
 */
export function uzSlotsNeeded(
  uzCount: number,
  totalCount: number,
  slots: number,
): number {
  if (slots <= 0) return 0;

  const idealUz = ((totalCount + slots) * UZ_QUOTA_TARGET) / 100;
  const needed = Math.round(idealUz - uzCount);
  return Math.max(0, Math.min(slots, needed));
}

/**
 * True when the next item should be Uzbekistan content, given what has been
 * published this month. Used for the single-item / instant-post flow where
 * there is no batch to apportion.
 */
export function shouldPickUzbekistanNext(uzCount: number, totalCount: number): boolean {
  // Would publishing one more non-Uzbekistan item push the month below the
  // lower bound? If so, the next slot belongs to the quota.
  const shareIfNotUz = (uzCount / (totalCount + 1)) * 100;
  return shareIfNotUz < UZ_QUOTA_BOUNDS.min;
}

/** One-line summary for the editorial dashboard and weekly report (TZ §16). */
export function describe(a: QuotaAssessment): string {
  const range = `${UZ_QUOTA_BOUNDS.min}-${UZ_QUOTA_BOUNDS.max}%`;
  switch (a.verdict) {
    case "UNDETERMINED":
      return `Uzbekistan share ${a.share}% of ${a.totalCount} published — too few items to judge (need ${QUOTA_MIN_SAMPLE}).`;
    case "ON_TARGET":
      return `Uzbekistan share ${a.share}% — on target (${range}).`;
    case "UNDER":
      return `Uzbekistan share ${a.share}% — UNDER the ${range} band by ${Math.abs(a.drift).toFixed(1)}pp. Commission more verified Uzbekistan material.`;
    case "OVER":
      return `Uzbekistan share ${a.share}% — OVER the ${range} band by ${a.drift.toFixed(1)}pp. Give the next slots to target-market stories.`;
  }
}

/** The Uzbekistan-desk research brief (TZ §5.3), injected into the prompt. */
export function uzPriorityPromptBlock(): string {
  return [
    `UZBEKISTAN DESK — priority directions:`,
    ...UZ_PRIORITY_DIRECTIONS.map((d) => `- ${d}`),
    ``,
    `This quota exists to convey credible, positive, investment-relevant EVIDENCE`,
    `to an international audience — not to praise. Every claim must rest on a`,
    `document, official statistic, or verifiable real result. Reject anything that`,
    `reads as promotion without evidence.`,
  ].join("\n");
}
