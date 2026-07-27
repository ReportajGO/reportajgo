import { logger } from "../config/logger.js";
import { getRuntimeConfig } from "../config/settingsStore.js";
import { prisma } from "../db/client.js";
import { meetsMinPriority } from "../domain/priority.js";
import type { RankVerdict, ResearchedNews } from "../domain/types.js";
import { contentHash } from "./hash.js";
import { rankNews } from "./rank.js";

const log = logger.child({ module: "filter" });

/** Case-insensitive substring match; returns the first matching term, or null. */
function matchesAny(haystack: string, terms: string[]): string | null {
  const h = haystack.toLowerCase();
  for (const term of terms) {
    const needle = term.trim().toLowerCase();
    if (needle && h.includes(needle)) return term;
  }
  return null;
}

/** Bare hostname (no leading www.) of a URL, or "" when unparseable. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return "";
  }
}

/**
 * Deterministic source/keyword gate applied BEFORE the (paid) LLM ranking, so
 * blocked/off-topic items are dropped cheaply. Returns a drop reason, or null
 * when the item passes and should proceed to editorial ranking.
 */
function preFilter(
  item: { title: string; summary: string; sourceName: string | null; sourceUrl: string },
  cfg: {
    sourceAllowlist: string[];
    sourceBlocklist: string[];
    keywordAllowlist: string[];
    keywordBlocklist: string[];
  },
): string | null {
  const sourceHay = `${item.sourceName ?? ""} ${hostOf(item.sourceUrl)}`;
  const contentHay = `${item.title} ${item.summary}`;

  const blockedSource = matchesAny(sourceHay, cfg.sourceBlocklist);
  if (blockedSource) return `blocked source: ${blockedSource}`;
  if (cfg.sourceAllowlist.length && !matchesAny(sourceHay, cfg.sourceAllowlist)) {
    return "source not in allowlist";
  }

  const blockedKeyword = matchesAny(contentHay, cfg.keywordBlocklist);
  if (blockedKeyword) return `blocked keyword: ${blockedKeyword}`;
  if (cfg.keywordAllowlist.length && !matchesAny(contentHay, cfg.keywordAllowlist)) {
    return "no required keyword";
  }
  return null;
}

/** Explain why a ranked item fell short of the keep thresholds. */
function dropReason(
  v: RankVerdict,
  cfg: { minScore: number; minRelevance: number; minPriority: RankVerdict["priority"] },
): string {
  const fails: string[] = [];
  if (v.score < cfg.minScore) fails.push(`score ${v.score.toFixed(2)}<${cfg.minScore}`);
  if (v.relevance < cfg.minRelevance) {
    fails.push(`relevance ${v.relevance.toFixed(2)}<${cfg.minRelevance}`);
  }
  if (!meetsMinPriority(v.priority, cfg.minPriority)) {
    fails.push(`priority ${v.priority}<${cfg.minPriority}`);
  }
  return `filtered (${fails.join("; ")})${v.reasons ? ` — ${v.reasons}` : ""}`;
}

/**
 * Persist researched candidates, skipping duplicates by content hash.
 * Returns the ids of newly inserted items.
 */
export async function persistNewItems(items: ResearchedNews[]): Promise<string[]> {
  const inserted: string[] = [];

  for (const item of items) {
    const hash = contentHash(item);
    try {
      const created = await prisma.newsItem.create({
        data: {
          title: item.title,
          summary: item.summary,
          sourceUrl: item.sourceUrl,
          sourceName: item.sourceName ?? null,
          language: item.language,
          topic: item.topic ?? null,
          publishedAt: item.publishedAt ?? null,
          contentHash: hash,
          status: "NEW",
        },
        select: { id: true },
      });
      inserted.push(created.id);
    } catch (err) {
      // Unique violation on contentHash => duplicate, expected. Skip quietly.
      if (isUniqueViolation(err)) continue;
      log.error({ err, title: item.title }, "failed to persist news item");
    }
  }

  log.info({ candidates: items.length, inserted: inserted.length }, "dedupe complete");
  return inserted;
}

/**
 * Rank all NEW items and mark them SELECTED or FILTERED_OUT. Applies the
 * operator-tunable "strong filter": a cheap deterministic source/keyword gate
 * first, then the LLM editorial ranking gated on min score, min relevance, and
 * min priority level. All thresholds come from runtime config (live-editable).
 */
export async function rankPendingItems(): Promise<{ selected: number; dropped: number }> {
  const cfg = await getRuntimeConfig();
  const pending = await prisma.newsItem.findMany({ where: { status: "NEW" } });
  let selected = 0;
  let dropped = 0;
  let preFiltered = 0;

  for (const item of pending) {
    // 1) Deterministic gate before spending an LLM call.
    const preDrop = preFilter(item, cfg);
    if (preDrop) {
      await prisma.newsItem.update({
        where: { id: item.id },
        data: { status: "FILTERED_OUT", rankReasons: `filtered (${preDrop})` },
      });
      dropped++;
      preFiltered++;
      continue;
    }

    // 2) Editorial LLM ranking, gated on the runtime thresholds.
    const verdict = await rankNews(item);
    const keep =
      verdict.score >= cfg.minScore &&
      verdict.relevance >= cfg.minRelevance &&
      meetsMinPriority(verdict.priority, cfg.minPriority);

    await prisma.newsItem.update({
      where: { id: item.id },
      data: {
        score: verdict.score,
        relevance: verdict.relevance,
        priority: verdict.priority,
        rankReasons: keep ? verdict.reasons : dropReason(verdict, cfg),
        status: keep ? "SELECTED" : "FILTERED_OUT",
      },
    });
    keep ? selected++ : dropped++;
  }

  log.info({ selected, dropped, preFiltered }, "ranking complete");
  return { selected, dropped };
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "P2002"
  );
}
