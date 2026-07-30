// Research stage — Reportage GO Global Media Network.
//
// Source of truth: TZ §5 (kontent arxitekturasi), §4 (tamoyillar), §8 (markets),
// §5.2/§5.3 (Uzbekistan quota + priority directions), §6 (prohibitions).
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT CHANGED, AND WHY
//
// The previous implementation researched "the most important and BREAKING real
// news from anywhere in the world", ranked by recency, and discarded anything
// older than 24 hours as "stale and useless".
//
// Under the Global Media Network concept every one of those instructions is
// off-strategy:
//   * Reportage GO does not publish breaking news. Urgency-driven, negative and
//     conflict material is a PROHIBITED category (TZ §6), not a priority.
//   * The agenda is constructive: solution, opportunity, progress, useful
//     knowledge (TZ §4). A story earns its slot on constructive value, never on
//     how dramatic or fresh it is.
//   * Content is researched per VERTICAL (7, at fixed shares) and per MARKET
//     (21, each with its own audience and platforms) — not as one global feed.
//     The market picks WHICH stories qualify; it never picks the language the
//     brief is written in. That is the operator's setting (src/domain/language.ts).
//   * Evergreen material is explicitly wanted: TZ §21 asks for a bank of 50
//     evergreen ideas per pilot market. A 24-hour window would exclude most of
//     the strategy's own content.
//
// So the freshness window survives only as a relevance guard with a much wider
// default, and recency is no longer a ranking signal.
// ─────────────────────────────────────────────────────────────────────────────

import { getRuntimeConfig } from "../config/settingsStore.js";
import { logger } from "../config/logger.js";
import { prohibitionPromptBlock } from "../domain/editorial.js";
import {
  languageName,
  languageRulePromptBlock,
  resolvePublicationLanguage,
} from "../domain/language.js";
import { marketOf, type Market } from "../domain/markets.js";
import { uzPriorityPromptBlock } from "../domain/quota.js";
import type { MarketCode, ResearchedNews, Vertical } from "../domain/types.js";
import { isVertical, verticalOf, verticalForDay, verticalsForRun } from "../domain/verticals.js";
import { getEditorialStateSafe } from "../strategy/editorialState.js";
import { uzSlotsNeeded } from "../domain/quota.js";
import { groundedJson } from "./gemini.js";

const log = logger.child({ module: "research" });

interface RawNews {
  title?: string;
  summary?: string;
  sourceUrl?: string;
  sourceName?: string;
  language?: string;
  topic?: string;
  publishedAt?: string;
  constructiveAngle?: string;
  additionalSources?: string[];
}

/** The JSON contract every research prompt returns. */
const RESPONSE_SHAPE = [
  `{`,
  `  "title": string,              // factual, non-sensational headline`,
  `  "summary": string,            // 2-4 sentence neutral summary`,
  `  "constructiveAngle": string,  // the solution / opportunity / useful takeaway`,
  `  "sourceUrl": string,          // real, primary article or document URL`,
  `  "sourceName": string,         // publisher or institution name`,
  `  "additionalSources": string[],// corroborating URLs, [] if none`,
  `  "language": string,           // the SOURCE article's language code — this`,
  `                                // field reports it, it does NOT change the`,
  `                                // language you write "title"/"summary" in`,
  `  "publishedAt": string         // ISO 8601 if known, else ""`,
  `}`,
].join("\n");

/** Shared source-discipline and anti-invention rules (TZ §4). */
function sourceRules(): string {
  return [
    `SOURCE DISCIPLINE:`,
    `- Every item must come from a real search result. Never invent facts, figures,`,
    `  names, quotes or URLs.`,
    `- Each claim needs at least one reliable PRIMARY source, or two independent`,
    `  secondary sources. Put the strongest one in "sourceUrl".`,
    `- Reject unverified praise, fabricated numbers and "world's only" style claims.`,
    `- If you cannot verify an item, omit it. A short list of solid items beats a`,
    `  long list of weak ones.`,
  ].join("\n");
}

/**
 * Research brief for one vertical aimed at one market.
 *
 * The prompt is built around constructive value rather than newsworthiness, and
 * carries the market's own platform/cultural framing so candidates are already
 * fit for that audience instead of being generic wire copy. The brief itself is
 * always written in the operator's publication language.
 */
function buildVerticalPrompt(
  vertical: Vertical,
  market: Market,
  hours: number,
  limit: number,
  language: string,
): string {
  const v = verticalOf(vertical);
  return [
    `You are a researcher for Reportage GO, an international CONSTRUCTIVE media`,
    `network. You are sourcing material for one specific vertical and one`,
    `specific national audience.`,
    ``,
    languageRulePromptBlock(language),
    `- Sources may be in ANY language; only your written output is ${languageName(language)}.`,
    ``,
    `VERTICAL: ${v.nameEn} (${v.name})`,
    `Subject matter: ${v.scope}.`,
    ``,
    `TARGET MARKET: ${market.nameEn}`,
    `Local framing: ${market.localizationNote}`,
    `The market decides WHICH stories qualify, not what language you write in.`,
    ``,
    `WHAT MAKES A STORY PUBLISHABLE HERE:`,
    `- It centres on a SOLUTION, an OPPORTUNITY, measurable PROGRESS, or genuinely`,
    `  useful KNOWLEDGE. Every item must have a clear constructive angle.`,
    `- It is relevant or interesting to a ${market.nameEn} audience specifically —`,
    `  business relevance, a comparable local situation, or a cooperation angle.`,
    `- It is factual, verifiable and non-sensational.`,
    ``,
    `Do NOT rank by urgency or drama. A well-evidenced story about a working`,
    `solution outranks a dramatic one every time.`,
    ``,
    prohibitionPromptBlock(),
    ``,
    sourceRules(),
    ``,
    `RECENCY: prefer material from the last ${hours} hours, but genuinely valuable`,
    `evergreen material (a research result, a working technology, a founder's`,
    `story, a durable fact) is equally welcome. Do not discard a strong item just`,
    `because it is not from today.`,
    ``,
    `Use Google Search. Return ONLY a JSON array (no prose) of up to ${limit} items:`,
    RESPONSE_SHAPE,
  ].join("\n");
}

/**
 * The Uzbekistan desk brief (TZ §5.3) — the 20% of every month's output that
 * carries verified, positive, investment-relevant Uzbekistan material to an
 * international audience.
 */
function buildUzbekistanPrompt(
  market: Market,
  vertical: Vertical,
  limit: number,
  language: string,
): string {
  const v = verticalOf(vertical);
  return [
    `You are the Uzbekistan desk researcher for Reportage GO, an international`,
    `media network. You source verified, positive, evidence-based material about`,
    `UZBEKISTAN for a foreign audience.`,
    ``,
    languageRulePromptBlock(language),
    `- Sources may be in ANY language; only your written output is ${languageName(language)}.`,
    ``,
    `TARGET MARKET: ${market.nameEn}`,
    `Local framing: ${market.localizationNote}`,
    `VERTICAL: ${v.nameEn} — ${v.scope}.`,
    ``,
    uzPriorityPromptBlock(),
    ``,
    `RELEVANCE REQUIREMENT: each item must give a ${market.nameEn} reader a reason`,
    `to care — an investment opening, an export or partnership angle, a research`,
    `collaboration, a comparable success, or a concrete travel/business draw.`,
    ``,
    prohibitionPromptBlock(),
    ``,
    sourceRules(),
    ``,
    `Additional rule for this desk: no state-praise framing, and no attributing`,
    `achievements to political figures. Report the RESULT and the EVIDENCE.`,
    ``,
    `Use Google Search. Return ONLY a JSON array (no prose) of up to ${limit} items:`,
    RESPONSE_SHAPE,
  ].join("\n");
}

/** Prompt to read ONE specific article URL and extract its content. */
function buildUrlPrompt(url: string, language: string): string {
  return [
    `You are an editor at Reportage GO, an international constructive media`,
    `network. Read the SPECIFIC article at this exact URL and extract its content:`,
    url,
    ``,
    languageRulePromptBlock(language),
    `- The article itself may be in any language; your output is still ${languageName(language)}.`,
    ``,
    `Use Google Search to open and read that exact page. Base EVERYTHING strictly`,
    `on that article's real content — do NOT invent facts, numbers, names or`,
    `quotes. If you cannot access the article, return {"title":""}.`,
    ``,
    prohibitionPromptBlock(),
    ``,
    `Also classify the item and state its constructive angle. If the article is`,
    `fundamentally political, criminal, conflict-related, disaster-related or`,
    `scandal-driven, still extract it faithfully but set "constructiveAngle" to ""`,
    `— the compliance gate will drop it.`,
    ``,
    `Return ONLY JSON (no prose):`,
    `{`,
    `  "title": string,`,
    `  "summary": string,              // 3-4 sentence neutral summary`,
    `  "constructiveAngle": string,    // the solution/opportunity, or "" if none`,
    `  "sourceUrl": string,`,
    `  "sourceName": string,`,
    `  "additionalSources": string[],`,
    `  "language": string,             // the SOURCE article's language code; it`,
    `                                  // does NOT change your output language`,
    `  "topic": string,                // one of: ECONOMY, INNOVATION, SCIENCE, STARTUP, PEOPLE, FACTS, HISTORY`,
    `  "publishedAt": string           // ISO 8601 if known, else ""`,
    `}`,
  ].join("\n");
}

/**
 * Extract a single news article from a specific URL into a normalized candidate.
 * Used by the operator-driven "send a link → instant post" flow.
 */
export async function researchUrl(url: string): Promise<ResearchedNews> {
  const { contentLanguages } = await getRuntimeConfig();
  const language = resolvePublicationLanguage(contentLanguages);
  log.info({ url, language }, "researching single url");
  const { data } = await groundedJson<RawNews | RawNews[]>(buildUrlPrompt(url, language));
  const r = Array.isArray(data) ? data[0] : data;
  if (!r || !r.title?.trim() || !r.summary?.trim()) {
    throw new Error("could not read the article at that link");
  }

  // The operator chose this link deliberately, so classify it into a vertical
  // rather than rejecting it for lacking one. Compliance still applies later.
  const vertical: Vertical = isVertical(r.topic?.trim().toUpperCase())
    ? (r.topic!.trim().toUpperCase() as Vertical)
    : "ECONOMY";

  return normalize(
    { ...r, sourceUrl: r.sourceUrl?.trim() || url },
    { vertical, uzbekistanQuota: false },
  );
}

export interface VerticalResearchOptions {
  vertical: Vertical;
  market: MarketCode;
  /** Research the Uzbekistan desk brief instead of the general vertical brief. */
  uzbekistanDesk?: boolean;
  limit?: number;
}

/** Research one vertical for one market and return normalized candidates. */
export async function researchVertical(
  opts: VerticalResearchOptions,
): Promise<ResearchedNews[]> {
  const { vertical, market: marketCode, uzbekistanDesk = false } = opts;
  const market = marketOf(marketCode);
  const { researchMaxAgeHours, contentLanguages } = await getRuntimeConfig();
  const language = resolvePublicationLanguage(contentLanguages);
  const limit = opts.limit ?? 6;

  log.info({ vertical, market: marketCode, uzbekistanDesk, language }, "researching vertical");

  const prompt = uzbekistanDesk
    ? buildUzbekistanPrompt(market, vertical, limit, language)
    : buildVerticalPrompt(vertical, market, researchMaxAgeHours, limit, language);

  const { data, sources } = await groundedJson<RawNews[]>(prompt);
  const items = Array.isArray(data) ? data : [];

  const normalized = items
    .filter((r) => r.title?.trim() && r.summary?.trim() && r.sourceUrl?.trim())
    .map((r) =>
      normalize(r, {
        vertical,
        market: marketCode,
        uzbekistanQuota: uzbekistanDesk,
      }),
    );

  // Drop items whose constructive angle is missing: under TZ §4 an item with no
  // solution/opportunity/knowledge value is off-strategy by definition, so it
  // would only be dropped later at a higher cost.
  const constructive = normalized.filter((n) => Boolean(n.constructiveAngle));
  const noAngle = normalized.length - constructive.length;

  log.info(
    {
      vertical,
      market: marketCode,
      uzbekistanDesk,
      found: constructive.length,
      noAngle,
      sources: sources.length,
    },
    "vertical research complete",
  );
  return constructive;
}

/**
 * Plan and run one research cycle across the active markets and verticals.
 *
 * The plan is built, not configured:
 *   1. Active markets come from the rollout phase (TZ §19) — phase 1 is the six
 *      pilot markets, phase 3 is all 21.
 *   2. Verticals are chosen per market by how far each sits BELOW its target
 *      share, with the weekday's rhythm vertical leading (TZ §5.2, §13.1).
 *   3. Uzbekistan-desk slots are allocated to steer the month's share toward
 *      20% ±2% (TZ §5.2).
 *
 * One failing brief never aborts the cycle.
 */
export async function researchAllTopics(): Promise<ResearchedNews[]> {
  const cfg = await getRuntimeConfig();
  const state = await getEditorialStateSafe();

  const markets = cfg.activeMarkets;
  if (markets.length === 0) {
    log.warn("no active markets configured; nothing to research");
    return [];
  }

  const lead = verticalForDay(new Date());
  const verticals = verticalsForRun(
    state.verticalCounts,
    cfg.verticalsPerRun,
    lead,
  );

  // How many of this cycle's briefs should be Uzbekistan-desk briefs, to steer
  // the monthly share back to 20%.
  const totalBriefs = markets.length * verticals.length;
  const uzBriefs = uzSlotsNeeded(
    state.quota.uzCount,
    state.quota.totalCount,
    totalBriefs,
  );

  const briefs: VerticalResearchOptions[] = [];
  for (const market of markets) {
    for (const vertical of verticals) {
      briefs.push({ vertical, market, uzbekistanDesk: false });
    }
  }

  // Spread the Uzbekistan briefs evenly across the cycle rather than loading
  // them all onto the first market, so every audience gets Uzbekistan material.
  // uzSlotsNeeded clamps to the brief count, so the stride is always >= 1 and
  // the chosen indices are strictly increasing (no slot marked twice).
  if (uzBriefs > 0) {
    const stride = briefs.length / uzBriefs;
    for (let k = 0; k < uzBriefs; k++) {
      const slot = briefs[Math.min(briefs.length - 1, Math.floor(k * stride))]!;
      slot.uzbekistanDesk = true;
    }
  }

  log.info(
    {
      markets,
      verticals,
      lead,
      briefs: briefs.length,
      uzBriefs: briefs.filter((b) => b.uzbekistanDesk).length,
      quota: state.quota.verdict,
      quotaShare: state.quota.share,
    },
    "research cycle planned",
  );

  const results = await Promise.allSettled(briefs.map((b) => researchVertical(b)));

  const all: ResearchedNews[] = [];
  for (const [i, r] of results.entries()) {
    if (r.status === "fulfilled") all.push(...r.value);
    else log.error({ err: r.reason, brief: briefs[i] }, "research brief failed");
  }

  log.info({ candidates: all.length }, "research cycle complete");
  return all;
}

interface NormalizeContext {
  vertical: Vertical;
  market?: MarketCode;
  uzbekistanQuota: boolean;
}

function normalize(r: RawNews, ctx: NormalizeContext): ResearchedNews {
  const published = r.publishedAt ? new Date(r.publishedAt) : undefined;

  const base: ResearchedNews = {
    title: r.title!.trim(),
    summary: r.summary!.trim(),
    sourceUrl: r.sourceUrl!.trim(),
    language: (r.language || "en").trim().toLowerCase(),
    // `topic` stays the human-facing category used for website theming; the
    // machine-readable dimension is `vertical`.
    topic: verticalOf(ctx.vertical).nameEn,
    vertical: ctx.vertical,
    uzbekistanQuota: ctx.uzbekistanQuota,
  };

  if (ctx.market) base.market = ctx.market;
  if (r.sourceName?.trim()) base.sourceName = r.sourceName.trim();
  if (r.constructiveAngle?.trim()) base.constructiveAngle = r.constructiveAngle.trim();
  if (published && !Number.isNaN(published.getTime())) base.publishedAt = published;

  const extra = (r.additionalSources ?? [])
    .map((s) => (typeof s === "string" ? s.trim() : ""))
    .filter((s) => s && s !== base.sourceUrl);
  if (extra.length) base.additionalSources = [...new Set(extra)];

  return base;
}
