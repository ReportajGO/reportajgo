import { logger } from "../config/logger.js";
import type { RankVerdict } from "../domain/types.js";
import { generateJson } from "../research/gemini.js";

const log = logger.child({ module: "rank" });

const MIN_KEEP_SCORE = 0.45;

interface RawVerdict {
  score?: number;
  relevance?: number;
  reasons?: string;
}

/**
 * Score a news item for posting priority. Combines a Gemini editorial judgment
 * with a hard floor so low-value items are dropped automatically.
 */
export async function rankNews(item: {
  title: string;
  summary: string;
  sourceName?: string | null;
  topic?: string | null;
}): Promise<RankVerdict> {
  const prompt = [
    `You are the editor of a regional news channel. Rate this news item for`,
    `social-media posting priority. Be strict — filter out trivial, duplicate-feeling,`,
    `clickbait, low-credibility, or off-topic items.`,
    ``,
    `Topic focus: ${item.topic ?? "general regional news"}`,
    `Title: ${item.title}`,
    `Summary: ${item.summary}`,
    `Source: ${item.sourceName ?? "unknown"}`,
    ``,
    `Return ONLY JSON: { "score": 0..1, "relevance": 0..1, "reasons": string }`,
    `score = overall posting priority (newsworthiness x audience interest x credibility).`,
  ].join("\n");

  try {
    const raw = await generateJson<RawVerdict>(prompt);
    const score = clamp01(raw.score);
    const relevance = clamp01(raw.relevance);
    return {
      score,
      relevance,
      keep: score >= MIN_KEEP_SCORE,
      reasons: raw.reasons ?? "",
    };
  } catch (err) {
    log.warn({ err, title: item.title }, "ranking failed; defaulting to keep=false");
    return { score: 0, relevance: 0, keep: false, reasons: "ranking error" };
  }
}

function clamp01(n: unknown): number {
  const v = typeof n === "number" ? n : 0;
  return Math.min(1, Math.max(0, v));
}
