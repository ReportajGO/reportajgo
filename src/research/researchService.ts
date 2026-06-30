import { env } from "../config/env.js";
import { getRuntimeConfig } from "../config/settingsStore.js";
import { logger } from "../config/logger.js";
import type { ResearchedNews } from "../domain/types.js";
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
}

function buildPrompt(topic: string, languages: string[], hours: number): string {
  const langList = languages.join(", ");
  const sources = env.researchSources.join(", ");
  return [
    `You are a news researcher for a worldwide DAILY social-media news channel.`,
    `Use Google Search to find the most important and BREAKING real news from anywhere in the world about: "${topic}".`,
    `Prioritize globally significant stories; do not restrict to any single country or region.`,
    `Draw especially from major global news platforms such as: ${sources}. Also accept other reputable international outlets.`,
    `LATEST ONLY: include ONLY news published within the last ${hours} hours (today's news).`,
    `This is a daily channel — anything older than ${hours} hours is stale and useless; DISCARD it.`,
    `Rank by recency and importance, freshest first.`,
    `Do NOT invent facts or URLs — every item must come from a real search result.`,
    ``,
    `Return ONLY a JSON array (no prose) of up to 8 items, each:`,
    `{`,
    `  "title": string,           // concise factual headline`,
    `  "summary": string,         // 2-3 sentence neutral summary`,
    `  "sourceUrl": string,       // real article URL`,
    `  "sourceName": string,      // publisher name`,
    `  "language": string,        // source language code (e.g. "uz","ru","en")`,
    `  "publishedAt": string      // ISO 8601 if known, else ""`,
    `}`,
    ``,
    `Posts will be written in: ${langList}. Pick globally newsworthy stories that travel across borders.`,
  ].join("\n");
}

/** Prompt to read ONE specific article URL and extract its content. */
function buildUrlPrompt(url: string): string {
  return [
    `You are a news editor. Read the SPECIFIC news article at this exact URL and extract its content:`,
    url,
    `Use Google Search to open and read that exact page. Base EVERYTHING strictly on that`,
    `article's real content — do NOT invent facts, numbers, names, or quotes. If you cannot`,
    `access the article, return {"title":""}.`,
    ``,
    `Return ONLY JSON (no prose):`,
    `{`,
    `  "title": string,        // the article's factual headline`,
    `  "summary": string,      // 3-4 sentence neutral summary of the actual article`,
    `  "sourceUrl": string,    // the article URL`,
    `  "sourceName": string,   // the publisher name`,
    `  "language": string,     // the article's language code (e.g. "en","ru","uz")`,
    `  "topic": string,        // a short news category, e.g. "World","Business","Technology","Sports","Politics"`,
    `  "publishedAt": string   // ISO 8601 if known, else ""`,
    `}`,
  ].join("\n");
}

/**
 * Extract a single news article from a specific URL into a normalized candidate.
 * Used by the operator-driven "send a link → instant post" flow.
 */
export async function researchUrl(url: string): Promise<ResearchedNews> {
  log.info({ url }, "researching single url");
  const { data } = await groundedJson<RawNews | RawNews[]>(buildUrlPrompt(url));
  const r = Array.isArray(data) ? data[0] : data;
  if (!r || !r.title?.trim() || !r.summary?.trim()) {
    throw new Error("could not read the article at that link");
  }
  return normalize({ ...r, sourceUrl: r.sourceUrl?.trim() || url }, r.topic?.trim() || "World");
}

/** Research one topic and return normalized candidates. */
export async function researchTopic(topic: string): Promise<ResearchedNews[]> {
  log.info({ topic }, "researching topic");
  const { contentLanguages, researchMaxAgeHours } = await getRuntimeConfig();
  const { data, sources } = await groundedJson<RawNews[]>(
    buildPrompt(topic, contentLanguages, researchMaxAgeHours),
  );

  const items = Array.isArray(data) ? data : [];
  const normalized = items
    .filter((r) => r.title && r.summary && r.sourceUrl)
    .map((r) => normalize(r, topic));

  // Drop anything with a known publish date older than the freshness window.
  // Items with an unknown date are kept (the prompt already constrains recency).
  const cutoff = Date.now() - researchMaxAgeHours * 60 * 60 * 1000;
  const fresh = normalized.filter((n) => !n.publishedAt || n.publishedAt.getTime() >= cutoff);
  const dropped = normalized.length - fresh.length;

  log.info(
    { topic, found: fresh.length, dropped, sources: sources.length },
    "research complete",
  );
  return fresh;
}

/** Research every configured topic. Failures on one topic don't abort the rest. */
export async function researchAllTopics(): Promise<ResearchedNews[]> {
  const { researchTopics } = await getRuntimeConfig();
  const results = await Promise.allSettled(
    researchTopics.map((t) => researchTopic(t)),
  );

  const all: ResearchedNews[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") all.push(...r.value);
    else log.error({ err: r.reason }, "topic research failed");
  }
  return all;
}

function normalize(r: RawNews, topic: string): ResearchedNews {
  const published = r.publishedAt ? new Date(r.publishedAt) : undefined;
  const base: ResearchedNews = {
    title: r.title!.trim(),
    summary: r.summary!.trim(),
    sourceUrl: r.sourceUrl!.trim(),
    language: (r.language || "en").trim().toLowerCase(),
    topic,
  };
  if (r.sourceName?.trim()) base.sourceName = r.sourceName.trim();
  if (published && !Number.isNaN(published.getTime())) base.publishedAt = published;
  return base;
}
