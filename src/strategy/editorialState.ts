// Current editorial state, read from the database.
//
// The `domain/` modules are pure: they compute target mixes, quota maths and
// compliance verdicts from numbers handed to them. This module is the seam that
// supplies those numbers — it is the only place that turns published history
// into the counts the strategy logic balances against.
//
// Feeds:
//   * vertical selection in the research stage      (TZ §5.2 shares)
//   * format selection in the drafting stage        (TZ §7.1 mix)
//   * the 20% ±2% Uzbekistan quota                  (TZ §5.2, §15)

import { logger } from "../config/logger.js";
import { prisma } from "../db/client.js";
import { assess, monthStart } from "../domain/quota.js";
import type {
  ContentFormat,
  QuotaAssessment,
  Vertical,
} from "../domain/types.js";

const log = logger.child({ module: "editorial-state" });

/** How far back the vertical/format mix is measured, in days. */
const MIX_WINDOW_DAYS = 30;

export interface EditorialState {
  /** Items per vertical over the mix window. */
  verticalCounts: Partial<Record<Vertical, number>>;
  /** Drafts per format over the mix window. */
  formatCounts: Partial<Record<ContentFormat, number>>;
  /** This calendar month's Uzbekistan quota position. */
  quota: QuotaAssessment;
}

function windowStart(days = MIX_WINDOW_DAYS): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

/**
 * Items per vertical over the mix window, counting everything that made it past
 * the filter (SELECTED or DRAFTED). Filtered-out candidates are excluded — they
 * were never part of the published mix, so counting them would let a rejected
 * flood of one vertical starve that vertical of future slots.
 */
export async function verticalCounts(): Promise<Partial<Record<Vertical, number>>> {
  const rows = await prisma.newsItem.groupBy({
    by: ["vertical"],
    where: {
      fetchedAt: { gte: windowStart() },
      status: { in: ["SELECTED", "DRAFTED"] },
    },
    _count: { _all: true },
  });

  const counts: Partial<Record<Vertical, number>> = {};
  for (const r of rows) {
    if (r.vertical) counts[r.vertical as Vertical] = r._count._all;
  }
  return counts;
}

/**
 * Stories per production format over the mix window.
 *
 * Counts distinct news items rather than draft rows, for the same reason as
 * `quotaState`: a story's format is chosen once and then applied to every one of
 * its per-market/per-platform drafts, so counting rows would weight a story by
 * how many markets it went to and skew the format mix toward whatever formats
 * happened to be used by wide-fan-out (Uzbekistan) stories.
 */
export async function formatCounts(): Promise<Partial<Record<ContentFormat, number>>> {
  const rows = await prisma.postDraft.findMany({
    where: { createdAt: { gte: windowStart() }, format: { not: null } },
    select: { newsItemId: true, format: true },
    distinct: ["newsItemId"],
  });

  const counts: Partial<Record<ContentFormat, number>> = {};
  for (const r of rows) {
    if (!r.format) continue;
    const key = r.format as ContentFormat;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

/**
 * This calendar month's Uzbekistan quota position.
 *
 * Counts PUBLISHED output, not researched candidates: the quota is defined over
 * "barcha e'lon qilingan materiallar" — everything actually published (TZ §5.2).
 * Measuring intent instead of output would let the quota read as satisfied while
 * the Uzbekistan drafts sat unapproved.
 *
 * ─── Why this counts DISTINCT NEWS ITEMS, not draft rows ──────────────────────
 * One story now fans out to many drafts (one per market × platform), and the
 * fan-out width is deliberately UNEVEN: an Uzbekistan-quota story goes to every
 * active market, while a market-specific story goes to one (see marketsForItem
 * in generate/copy/copyService.ts). Counting draft rows would therefore multiply
 * Uzbekistan material by the market count and report a wildly inflated share.
 *
 * Concretely, with 6 markets and 4 platforms, 8 ordinary stories plus 2
 * Uzbekistan stories — an item-level share of exactly 20%, perfectly on target —
 * produces 48 Uzbekistan drafts out of 80 total, i.e. a measured 60% "OVER".
 * The research allocator would then commission ZERO Uzbekistan briefs, and stay
 * stuck there: the inflated reading persists for the rest of the month and
 * silently starves the very requirement the quota exists to enforce.
 *
 * A "material" in the strategy's sense is one story, so the unit of measurement
 * is the news item. `distinct` collapses each story's per-market versions back
 * into the single material they represent.
 */
export async function quotaState(now = new Date()): Promise<QuotaAssessment> {
  const since = monthStart(now);

  const published = await prisma.postDraft.findMany({
    where: { status: "PUBLISHED", updatedAt: { gte: since } },
    select: { newsItemId: true, newsItem: { select: { uzbekistanQuota: true } } },
    distinct: ["newsItemId"],
  });

  const total = published.length;
  const uz = published.filter((p) => p.newsItem.uzbekistanQuota).length;

  return assess(uz, total);
}

/** Everything the strategy stages need, in one round-trip set. */
export async function getEditorialState(now = new Date()): Promise<EditorialState> {
  const [verticals, formats, quota] = await Promise.all([
    verticalCounts(),
    formatCounts(),
    quotaState(now),
  ]);

  log.debug({ verticals, formats, quota }, "editorial state resolved");
  return { verticalCounts: verticals, formatCounts: formats, quota };
}

/**
 * Fallback state used when the database is unreachable. Empty counts mean the
 * balancers fall back to pure target shares (ECONOMY-first, video-first), and an
 * undetermined quota means the Uzbekistan allocator uses the plain target rather
 * than a correction. Degrades to "publish on strategy defaults" rather than
 * blocking the pipeline.
 */
export function defaultEditorialState(): EditorialState {
  return {
    verticalCounts: {},
    formatCounts: {},
    quota: assess(0, 0),
  };
}

/** State read that survives a DB outage, falling back to strategy defaults. */
export async function getEditorialStateSafe(now = new Date()): Promise<EditorialState> {
  try {
    return await getEditorialState(now);
  } catch (err) {
    log.warn({ err }, "editorial state unavailable; using strategy defaults");
    return defaultEditorialState();
  }
}
