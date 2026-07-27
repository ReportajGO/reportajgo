import { logger } from "../config/logger.js";
import { coercePriority } from "../domain/priority.js";
import type { RankVerdict } from "../domain/types.js";
import { generateJson } from "../research/gemini.js";

const log = logger.child({ module: "rank" });

interface RawVerdict {
  score?: number;
  relevance?: number;
  priority?: string;
  reasons?: string;
}

/**
 * Score a news item for posting priority. One Gemini editorial judgment returns
 * a 0..1 score, a 0..1 topical relevance, and a discrete priority level. The
 * keep/drop decision (against operator-tunable thresholds) lives in the filter
 * service so this stays a pure scorer.
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
    `Classify PRIORITY as exactly one of:`,
    `- "BREAKING": major, time-sensitive story of wide importance happening now.`,
    `- "HIGH": important and clearly newsworthy to a broad audience.`,
    `- "NORMAL": genuine news but routine; still worth posting.`,
    `- "LOW": trivial, filler, promotional, or of narrow interest.`,
    ``,
    `Return ONLY JSON: { "score": 0..1, "relevance": 0..1, "priority": "BREAKING"|"HIGH"|"NORMAL"|"LOW", "reasons": string }`,
    `score = overall posting priority (newsworthiness x audience interest x credibility).`,
    `relevance = how well the item fits the topic focus above (0..1).`,
    `Keep priority consistent with score (higher score => higher priority).`,
  ].join("\n");

  try {
    const raw = await generateJson<RawVerdict>(prompt);
    const score = clamp01(raw.score);
    const relevance = clamp01(raw.relevance);
    return {
      score,
      relevance,
      priority: coercePriority(raw.priority, score),
      reasons: raw.reasons ?? "",
    };
  } catch (err) {
    log.warn({ err, title: item.title }, "ranking failed; defaulting to drop");
    return { score: 0, relevance: 0, priority: "LOW", reasons: "ranking error" };
  }
}

function clamp01(n: unknown): number {
  const v = typeof n === "number" ? n : 0;
  return Math.min(1, Math.max(0, v));
}
