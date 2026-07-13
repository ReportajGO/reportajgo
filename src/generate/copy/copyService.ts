import { env } from "../../config/env.js";
import { getRuntimeConfig } from "../../config/settingsStore.js";
import { logger } from "../../config/logger.js";
import { prisma } from "../../db/client.js";
import { profileFor } from "../../domain/platforms.js";
import type { GeneratedCopy, Platform } from "../../domain/types.js";
import { generateJson } from "../../research/gemini.js";
import { generateCardHeadline } from "./headline.js";

const log = logger.child({ module: "copy" });

interface RawCopy {
  body?: string;
  hashtags?: string[];
}

interface SourceNews {
  id: string;
  title: string;
  summary: string;
  sourceName?: string | null;
  sourceUrl: string;
  topic?: string | null;
}

function buildPrompt(news: SourceNews, platform: Platform, language: string): string {
  const p = profileFor(platform);
  const capLine = p.maxChars
    ? `Hard limit: the body MUST be <= ${p.maxChars} characters (including emoji).`
    : `No hard character limit, but stay tight.`;
  const tagLine =
    p.hashtagCount > 0
      ? `Provide exactly ${p.hashtagCount} relevant hashtags (without the # in the array; we add it).`
      : `Provide no hashtags (empty array).`;

  return [
    `Write a social-media post for ${platform}.`,
    `Language: write the body in "${language}".`,
    ``,
    `STYLE:`,
    p.styleGuidance,
    ``,
    `RULES:`,
    `- Base it ONLY on the facts below. Do not invent details.`,
    `- ${capLine}`,
    `- ${tagLine}`,
    `- Neutral, credible, non-sensational tone.`,
    ``,
    `NEWS:`,
    `Title: ${news.title}`,
    `Summary: ${news.summary}`,
    `Source: ${news.sourceName ?? "unknown"} (${news.sourceUrl})`,
    ``,
    `Return ONLY JSON: { "body": string, "hashtags": string[] }`,
  ].join("\n");
}

/** Generate copy for one platform/language combination. */
export async function generateCopy(
  news: SourceNews,
  platform: Platform,
  language: string,
): Promise<GeneratedCopy> {
  const p = profileFor(platform);
  const raw = await generateJson<RawCopy>(buildPrompt(news, platform, language), 0.7);

  let body = (raw.body ?? "").trim();
  if (p.maxChars && body.length > p.maxChars) {
    log.warn(
      { platform, len: body.length, cap: p.maxChars },
      "body over cap; truncating",
    );
    body = body.slice(0, p.maxChars).trimEnd();
  }

  const hashtags = (raw.hashtags ?? [])
    .map((h) => h.replace(/^#/, "").trim())
    .filter(Boolean)
    .slice(0, p.hashtagCount);

  return { platform, language, style: p.styleId, body, hashtags };
}

/**
 * Create PENDING_MEDIA drafts for ONE news item across the given platforms,
 * sharing a single themed card headline. Returns how many drafts were created.
 */
async function createDraftsForItem(
  news: SourceNews,
  language: string,
  platforms: string[],
): Promise<number> {
  let created = 0;
  // One themed card headline (in the post language) shared across this item's
  // platform drafts.
  let headline: string | null = null;
  try {
    headline = await generateCardHeadline(news, language);
  } catch (err) {
    log.warn({ err, newsId: news.id }, "card headline generation failed; will fall back to title");
  }
  const targetPlatforms = env.MEDIA_GENERATION_ENABLED
    ? platforms
    : platforms.filter((platform) => !profileFor(platform as Platform).mediaRequired);
  for (const platform of targetPlatforms) {
    try {
      const copy = await generateCopy(news, platform as Platform, language);
      await prisma.postDraft.create({
        data: {
          newsItemId: news.id,
          platform: copy.platform,
          language: copy.language,
          style: copy.style,
          headline,
          body: copy.body,
          hashtags: copy.hashtags,
          status: "PENDING_MEDIA",
        },
      });
      created++;
    } catch (err) {
      log.error({ err, newsId: news.id, platform }, "copy generation failed");
    }
  }
  return created;
}

/**
 * Draft ONE news item (operator-driven / instant flow) across all enabled
 * platforms in the primary content language. Marks the item DRAFTED on success.
 */
export async function draftNewsItem(newsId: string): Promise<{ drafts: number }> {
  const { contentLanguages, enabledPlatforms } = await getRuntimeConfig();
  const news = await prisma.newsItem.findUnique({ where: { id: newsId } });
  if (!news) throw new Error("news item not found");
  const language = contentLanguages[0] ?? "en";
  const drafts = await createDraftsForItem(news, language, enabledPlatforms);
  if (drafts > 0) {
    await prisma.newsItem.update({ where: { id: newsId }, data: { status: "DRAFTED" } });
  }
  log.info({ newsId, drafts }, "single item drafted");
  return { drafts };
}

/**
 * Create PostDrafts for every SELECTED news item across all enabled platforms,
 * using the primary content language. Marks the news item DRAFTED.
 */
export async function draftSelectedItems(): Promise<{ drafts: number }> {
  const { contentLanguages, enabledPlatforms, maxItemsPerRun } = await getRuntimeConfig();
  // Highest-scored, freshest first — we only draft the top N per run.
  const allSelected = await prisma.newsItem.findMany({
    where: { status: "SELECTED" },
    orderBy: [{ score: "desc" }, { publishedAt: "desc" }],
  });
  const selected = allSelected.slice(0, maxItemsPerRun);
  const overflow = allSelected.slice(maxItemsPerRun);

  // Drop the overflow so a daily channel stays lean and old items don't pile up
  // as perpetually-SELECTED across runs.
  if (overflow.length > 0) {
    await prisma.newsItem.updateMany({
      where: { id: { in: overflow.map((o) => o.id) } },
      data: { status: "FILTERED_OUT" },
    });
    log.info({ capped: maxItemsPerRun, droppedOverflow: overflow.length }, "per-run cap applied");
  }

  const language = contentLanguages[0] ?? "en";
  let drafts = 0;

  for (const news of selected) {
    const createdForItem = await createDraftsForItem(news, language, enabledPlatforms);
    drafts += createdForItem;
    // Only advance the item if at least one platform draft was created;
    // otherwise leave it SELECTED so a later run can retry (e.g. after a
    // transient quota/outage error clears).
    if (createdForItem > 0) {
      await prisma.newsItem.update({ where: { id: news.id }, data: { status: "DRAFTED" } });
    }
  }

  log.info({ drafts }, "drafting complete");
  return { drafts };
}
