import { logger } from "../config/logger.js";
import { coercePriority, priorityToScore } from "../domain/priority.js";
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
    // The Gemini call isn't schema-constrained, so tolerate quoted numbers and
    // missing fields. When a numeric is genuinely absent, derive it from the
    // (explicit) priority instead of collapsing to 0 — otherwise a real
    // BREAKING/HIGH story would be silently dropped by the score gate.
    const rawScore = parseUnit(raw.score);
    const priority = coercePriority(raw.priority, rawScore ?? 0);
    const score = rawScore ?? priorityToScore(priority);
    const relevance = parseUnit(raw.relevance) ?? score;
    return { score, relevance, priority, reasons: raw.reasons ?? "" };
  } catch (err) {
    // A transient failure (Gemini outage, malformed JSON) must NOT masquerade as
    // an editorial reject — that would permanently FILTER_OUT a good item. Throw
    // so the filter stage leaves it NEW to be re-ranked next run.
    log.warn({ err, title: item.title }, "ranking failed; leaving item for retry");
    throw err instanceof Error ? err : new Error("ranking failed");
  }
}

/** Parse a model-provided 0..1 value, tolerating numeric strings. null if absent/unparseable. */
function parseUnit(n: unknown): number | null {
  const v = typeof n === "number" ? n : typeof n === "string" ? Number(n.trim()) : NaN;
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : null;
}
