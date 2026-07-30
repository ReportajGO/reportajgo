// Copy generation — per market, per platform, per format.
//
// Source of truth: TZ §7 (formatlar), §7.2 (kontent pasporti), §11 (tarjima va
// lokalizatsiya), §4 (tamoyillar), §10.1 (tasdiqlash darajalari), §16 (UTM).
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT CHANGED, AND WHY
//
// Previously one story produced one draft per platform, all in a single language
// taken from contentLanguages[0], with the platform's style profile as the only
// variation.
//
// The network's core distribution rule (TZ §8) forbids that: "Barcha platformada
// bir xil post" — the same post everywhere — is explicitly not allowed. One
// master brief becomes a distinct version per MARKET (its own language and
// cultural framing) and per PLATFORM (its own length, hook and CTA), written
// against a production FORMAT (TZ §7).
//
// Every draft now also carries a content passport (TZ §7.2): the provenance,
// compliance and approval record that makes each published item auditable.
// ─────────────────────────────────────────────────────────────────────────────

import { env } from "../../config/env.js";
import { getRuntimeConfig } from "../../config/settingsStore.js";
import { logger } from "../../config/logger.js";
import { prisma } from "../../db/client.js";
import { principlesPromptBlock, prohibitionPromptBlock, maxTier } from "../../domain/editorial.js";
import { formatOf, nextFormat, productionPromptBlock } from "../../domain/formats.js";
import { findMarket, isRtlLanguage, type Market } from "../../domain/markets.js";
import { profileFor } from "../../domain/platforms.js";
import { priorityRank } from "../../domain/priority.js";
import type {
  ApprovalTier,
  ComplianceZone,
  ContentFormat,
  ContentPassport,
  GeneratedCopy,
  MarketCode,
  NewsPriority,
  Platform,
  Vertical,
} from "../../domain/types.js";
import { verticalOf } from "../../domain/verticals.js";
import { generateJson } from "../../research/gemini.js";
import { getEditorialStateSafe } from "../../strategy/editorialState.js";
import { buildUtmUrl } from "../../strategy/tracking.js";
import { generateCardHeadline } from "./headline.js";

const log = logger.child({ module: "copy" });

interface RawCopy {
  body?: string;
  hashtags?: string[];
  cta?: string;
}

/** The persisted news row fields copy generation needs. */
interface SourceNews {
  id: string;
  title: string;
  summary: string;
  sourceName?: string | null;
  sourceUrl: string;
  topic?: string | null;
  vertical?: Vertical | null;
  market?: string | null;
  uzbekistanQuota?: boolean;
  constructiveAngle?: string | null;
  additionalSources?: string[];
  complianceZone?: ComplianceZone | null;
  yellowRules?: string[];
  approvalTier?: ApprovalTier | null;
  websiteUrl?: string | null;
}

interface CopyContext {
  platform: Platform;
  language: string;
  market?: Market;
  format: ContentFormat;
}

function buildPrompt(news: SourceNews, ctx: CopyContext): string {
  const p = profileFor(ctx.platform);
  const f = formatOf(ctx.format);
  const vertical = news.vertical ? verticalOf(news.vertical) : undefined;

  const capLine = p.maxChars
    ? `Hard limit: the body MUST be <= ${p.maxChars} characters (including emoji).`
    : `No hard character limit, but stay tight.`;
  const tagLine =
    p.hashtagCount > 0
      ? `Provide exactly ${p.hashtagCount} relevant hashtags (without the # in the array; we add it).`
      : `Provide no hashtags (empty array).`;
  const wordLine = f.words
    ? `Target length: ${f.words.min}-${f.words.max} words.`
    : null;

  return [
    `Write a ${f.name} post for ${ctx.platform}, for Reportage GO — an`,
    `international constructive media network.`,
    ``,
    ctx.market ? `TARGET MARKET: ${ctx.market.nameEn}` : `TARGET MARKET: unspecified`,
    `Language: write the body in "${ctx.language}"${
      ctx.market ? ` for a ${ctx.market.nameEn} audience` : ""
    }.`,
    ctx.market ? `Local framing: ${ctx.market.localizationNote}` : null,
    isRtlLanguage(ctx.language)
      ? `This language is right-to-left: use correct RTL punctuation and local typography.`
      : null,
    ``,
    `LOCALISATION RULE (non-negotiable): this is TRANSCREATION, not translation.`,
    `Re-express the story the way a native editor in this market would write it —`,
    `local idiom, local examples, local number/date/currency conventions. Never`,
    `produce a word-for-word rendering of the source text.`,
    ``,
    productionPromptBlock(ctx.format),
    wordLine,
    ``,
    `PLATFORM STYLE:`,
    p.styleGuidance,
    ``,
    principlesPromptBlock(),
    ``,
    `RULES:`,
    `- Base it ONLY on the facts below. Do not invent details, figures or quotes.`,
    `- Lead with the constructive value: the solution, opportunity or takeaway.`,
    `- ${capLine}`,
    `- ${tagLine}`,
    `- Neutral, credible, non-sensational tone. No manufactured urgency.`,
    `- End with a clear, useful call to action in the "cta" field.`,
    ``,
    prohibitionPromptBlock(),
    ``,
    news.yellowRules?.length
      ? `SPECIAL HANDLING REQUIRED (yellow zone: ${news.yellowRules.join(", ")}). Follow the network's handling rules for these topics: cover state decisions only through economic impact, never present medical findings as treatment advice, and label partnership material openly.`
      : null,
    ``,
    `STORY:`,
    vertical ? `Vertical: ${vertical.nameEn}` : null,
    `Title: ${news.title}`,
    `Summary: ${news.summary}`,
    news.constructiveAngle ? `Constructive angle: ${news.constructiveAngle}` : null,
    `Source: ${news.sourceName ?? "unknown"} (${news.sourceUrl})`,
    news.additionalSources?.length
      ? `Corroborating sources: ${news.additionalSources.join(", ")}`
      : null,
    ``,
    `Return ONLY JSON: { "body": string, "hashtags": string[], "cta": string }`,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

/** Generate copy for one platform/market/format combination. */
export async function generateCopy(
  news: SourceNews,
  platform: Platform,
  language: string,
  opts: { market?: MarketCode | null; format?: ContentFormat } = {},
): Promise<GeneratedCopy & { cta?: string }> {
  const p = profileFor(platform);
  const market = opts.market ? findMarket(opts.market) : undefined;
  const format = opts.format ?? "TEXT_POST";

  const raw = await generateJson<RawCopy>(
    buildPrompt(news, { platform, language, market, format }),
    0.7,
  );

  let body = (raw.body ?? "").trim();
  if (p.maxChars && body.length > p.maxChars) {
    log.warn({ platform, len: body.length, cap: p.maxChars }, "body over cap; truncating");
    body = body.slice(0, p.maxChars).trimEnd();
  }

  const hashtags = (raw.hashtags ?? [])
    .map((h) => h.replace(/^#/, "").trim())
    .filter(Boolean)
    .slice(0, p.hashtagCount);

  const result: GeneratedCopy & { cta?: string } = {
    platform,
    language,
    style: p.styleId,
    body,
    hashtags,
  };
  if (raw.cta?.trim()) result.cta = raw.cta.trim();
  return result;
}

/**
 * The approval tier a draft requires (TZ §10.1).
 *
 * Starts from the item's compliance tier, then escalates:
 *   - Uzbekistan-quota, investment and company material → at least B.
 *   - Partnership/sponsored material → C.
 */
function resolveApprovalTier(news: SourceNews, partnership: boolean): ApprovalTier {
  let tier: ApprovalTier = news.approvalTier ?? "A";
  if (news.uzbekistanQuota) tier = maxTier(tier, "B");
  if (news.vertical === "ECONOMY" || news.vertical === "STARTUP") tier = maxTier(tier, "B");
  if (news.complianceZone === "YELLOW") tier = maxTier(tier, "C");
  if (partnership) tier = maxTier(tier, "C");
  return tier;
}

/** Assemble the content passport for a draft (TZ §7.2). */
function buildPassport(
  news: SourceNews,
  ctx: {
    platform: Platform;
    language: string;
    market: MarketCode | null;
    format: ContentFormat;
    tier: ApprovalTier;
    partnership: boolean;
    utmUrl: string | null;
    cta: string | null;
  },
): ContentPassport {
  return {
    market: ctx.market,
    language: ctx.language,
    platform: ctx.platform,
    vertical: news.vertical ?? null,
    format: ctx.format,
    uzbekistanQuota: news.uzbekistanQuota ?? false,
    primarySource: news.sourceUrl,
    additionalSources: news.additionalSources ?? [],
    complianceZone: news.complianceZone ?? "GREEN",
    yellowRules: news.yellowRules ?? [],
    approvalTier: ctx.tier,
    // Media is generated by the image/video providers, so any attached asset is
    // AI-generated and must carry the disclosure label (TZ §6.1).
    aiGeneratedMedia: env.MEDIA_GENERATION_ENABLED,
    utmUrl: ctx.utmUrl,
    cta: ctx.cta,
  };
}

/**
 * Create PENDING_MEDIA drafts for ONE news item, one per (market × platform).
 *
 * Each market gets its own language and framing; each platform within that
 * market gets its own length, hook and CTA. A single shared card headline per
 * market keeps the visual identity consistent across that market's platforms.
 */
async function createDraftsForItem(
  news: SourceNews,
  markets: MarketCode[],
  platforms: string[],
  format: ContentFormat,
): Promise<{ created: number; planned: number; missing: string[] }> {
  let created = 0;
  const missing: string[] = [];

  const targetPlatforms = env.MEDIA_GENERATION_ENABLED
    ? platforms
    : platforms.filter((platform) => !profileFor(platform as Platform).mediaRequired);

  // Versions that already exist (from a previous partially-failed run) are
  // skipped rather than re-generated, so a re-draft costs nothing for the legs
  // that already succeeded and cannot violate the uniqueness constraint.
  const existing = await prisma.postDraft.findMany({
    where: { newsItemId: news.id },
    select: { platform: true, market: true },
  });
  const done = new Set(existing.map((d) => `${d.market ?? ""}:${d.platform}`));
  const planned = markets.length * targetPlatforms.length;

  // Partnership material must be labelled openly (TZ §4, §18). The research
  // stage flags it via the commercial-interest yellow-zone rule.
  const partnership = (news.yellowRules ?? []).includes("commercial-interest");
  const tier = resolveApprovalTier(news, partnership);

  for (const marketCode of markets) {
    const market = findMarket(marketCode);
    const language = market?.primaryLanguage ?? "en";

    // Skip the whole market when every one of its platform versions already
    // exists, so we don't pay for a headline we won't use.
    const pendingPlatforms = targetPlatforms.filter(
      (platform) => !done.has(`${marketCode}:${platform}`),
    );
    if (pendingPlatforms.length === 0) continue;

    // One card headline per market, shared across that market's platforms.
    let headline: string | null = null;
    try {
      headline = await generateCardHeadline(news, { language, market: marketCode });
    } catch (err) {
      log.warn(
        { err, newsId: news.id, market: marketCode },
        "card headline generation failed; will fall back to title",
      );
    }

    for (const platform of pendingPlatforms) {
      try {
        const copy = await generateCopy(news, platform as Platform, language, {
          market: marketCode,
          format,
        });

        const utmUrl = buildUtmUrl({
          url: news.websiteUrl ?? null,
          market: marketCode,
          platform: platform as Platform,
          vertical: news.vertical ?? null,
          format,
        });

        await prisma.postDraft.create({
          data: {
            newsItemId: news.id,
            platform: copy.platform,
            language: copy.language,
            style: copy.style,
            headline,
            body: copy.body,
            hashtags: copy.hashtags,
            market: marketCode,
            format,
            approvalTier: tier,
            partnershipLabel: partnership,
            utmUrl,
            passport: buildPassport(news, {
              platform: copy.platform,
              language: copy.language,
              market: marketCode,
              format,
              tier,
              partnership,
              utmUrl,
              cta: copy.cta ?? null,
            }) as unknown as object,
            status: "PENDING_MEDIA",
          },
        });
        created++;
      } catch (err) {
        log.error({ err, newsId: news.id, market: marketCode, platform }, "copy generation failed");
        missing.push(`${marketCode}:${platform}`);
      }
    }
  }

  return { created, planned, missing };
}

/**
 * Which markets a given item is published to.
 *
 * An item researched FOR a specific market goes to that market only — it was
 * sourced for that audience. Uzbekistan-quota material goes to every active
 * market, since the whole point of the 20% is to carry it to all audiences
 * (TZ §5.2).
 */
function marketsForItem(news: SourceNews, activeMarkets: MarketCode[]): MarketCode[] {
  if (news.uzbekistanQuota) return activeMarkets;
  if (news.market && activeMarkets.includes(news.market as MarketCode)) {
    return [news.market as MarketCode];
  }
  // No market recorded (e.g. an operator-supplied link): fall back to the first
  // active market rather than fanning out to all 21 unintentionally.
  return activeMarkets.slice(0, 1);
}

/**
 * Draft ONE news item (operator-driven / instant flow) across the enabled
 * platforms and its target markets. Marks the item DRAFTED on success.
 */
export async function draftNewsItem(newsId: string): Promise<{ drafts: number }> {
  const cfg = await getRuntimeConfig();
  const news = await prisma.newsItem.findUnique({ where: { id: newsId } });
  if (!news) throw new Error("news item not found");

  const state = await getEditorialStateSafe();
  const format = nextFormat(state.formatCounts, cfg.availableFormats);
  const markets = marketsForItem(news as SourceNews, cfg.activeMarkets);

  const { created, planned, missing } = await createDraftsForItem(
    news as SourceNews,
    markets,
    cfg.enabledPlatforms,
    format,
  );
  if (created > 0) {
    await prisma.newsItem.update({ where: { id: newsId }, data: { status: "DRAFTED" } });
  }
  if (missing.length > 0) {
    log.error(
      { newsId, created, planned, missing },
      "incomplete market/platform coverage; re-drafting this item will fill only the missing versions",
    );
  }
  log.info({ newsId, drafts: created, markets, format }, "single item drafted");
  return { drafts: created };
}

/**
 * Create PostDrafts for every SELECTED news item across its target markets and
 * all enabled platforms. Marks each news item DRAFTED.
 */
export async function draftSelectedItems(): Promise<{ drafts: number }> {
  const cfg = await getRuntimeConfig();
  const state = await getEditorialStateSafe();

  // Order the queue by editorial value, NOT by urgency: constructiveness first,
  // then overall score, then priority, then freshness as a final tiebreak. This
  // is the inverse of the old "breaking jumps the queue" rule — the network does
  // not publish urgency-driven material (TZ §6).
  const allSelected = await prisma.newsItem.findMany({ where: { status: "SELECTED" } });
  allSelected.sort((a, b) => {
    const byConstructive = (b.constructiveness ?? 0) - (a.constructiveness ?? 0);
    if (byConstructive !== 0) return byConstructive;
    const byScore = (b.score ?? 0) - (a.score ?? 0);
    if (byScore !== 0) return byScore;
    const byPriority =
      priorityRank((b.priority ?? "NORMAL") as NewsPriority) -
      priorityRank((a.priority ?? "NORMAL") as NewsPriority);
    if (byPriority !== 0) return byPriority;
    return (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0);
  });

  const selected = allSelected.slice(0, cfg.maxItemsPerRun);
  const overflow = allSelected.slice(cfg.maxItemsPerRun);

  // Drop the overflow so the queue stays lean and old items don't pile up as
  // perpetually-SELECTED across runs.
  if (overflow.length > 0) {
    await prisma.newsItem.updateMany({
      where: { id: { in: overflow.map((o) => o.id) } },
      data: { status: "FILTERED_OUT" },
    });
    log.info(
      { capped: cfg.maxItemsPerRun, droppedOverflow: overflow.length },
      "per-run cap applied",
    );
  }

  // Track format usage across this run so the batch itself stays on the target
  // mix, instead of every item in the run picking the same under-served format.
  const runFormatCounts = { ...state.formatCounts };
  let drafts = 0;
  let incomplete = 0;

  for (const news of selected) {
    const format = nextFormat(runFormatCounts, cfg.availableFormats);
    const markets = marketsForItem(news as SourceNews, cfg.activeMarkets);

    const { created, planned, missing } = await createDraftsForItem(
      news as SourceNews,
      markets,
      cfg.enabledPlatforms,
      format,
    );
    drafts += created;

    // Advance the item once at least one version exists; leave it SELECTED when
    // nothing was created so a later run retries (e.g. after a transient quota
    // error clears).
    //
    // A PARTIAL fan-out still advances, deliberately: holding the item at
    // SELECTED would re-attempt it on every subsequent run, and since it sorts
    // near the front of the queue a permanently-failing market (an unsupported
    // language, a persistently malformed response) would burn the run's whole
    // budget forever. Instead the gap is logged at error level, and the
    // uniqueness constraint plus the skip-existing check above make a manual
    // re-draft cheap and idempotent — it regenerates only the missing versions.
    if (created > 0) {
      runFormatCounts[format] = (runFormatCounts[format] ?? 0) + 1;
      await prisma.newsItem.update({ where: { id: news.id }, data: { status: "DRAFTED" } });
    }
    if (missing.length > 0) {
      log.error(
        { newsId: news.id, created, planned, missing },
        "incomplete market/platform coverage for item",
      );
      incomplete++;
    }
  }

  log.info({ drafts, incomplete, quota: state.quota.verdict }, "drafting complete");
  return { drafts };
}
