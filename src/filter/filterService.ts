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

/** Thresholds the editorial gate is evaluated against. */
interface KeepThresholds {
  minScore: number;
  minRelevance: number;
  minPriority: RankVerdict["priority"];
  minConstructiveness: number;
  minVerifiability: number;
}

/**
 * Whether a ranked item clears the editorial gate.
 *
 * Compliance is checked first and separately by the caller: a RED verdict is not
 * a threshold failure that better scores could offset, it is a prohibition.
 */
function meetsThresholds(v: RankVerdict, cfg: KeepThresholds): boolean {
  return (
    v.score >= cfg.minScore &&
    v.relevance >= cfg.minRelevance &&
    v.constructiveness >= cfg.minConstructiveness &&
    v.verifiability >= cfg.minVerifiability &&
    meetsMinPriority(v.priority, cfg.minPriority)
  );
}

/** Explain why a ranked item fell short of the keep thresholds. */
function dropReason(v: RankVerdict, cfg: KeepThresholds): string {
  const fails: string[] = [];
  if (v.score < cfg.minScore) fails.push(`score ${v.score.toFixed(2)}<${cfg.minScore}`);
  if (v.relevance < cfg.minRelevance) {
    fails.push(`relevance ${v.relevance.toFixed(2)}<${cfg.minRelevance}`);
  }
  if (v.constructiveness < cfg.minConstructiveness) {
    fails.push(`constructiveness ${v.constructiveness.toFixed(2)}<${cfg.minConstructiveness}`);
  }
  if (v.verifiability < cfg.minVerifiability) {
    fails.push(`verifiability ${v.verifiability.toFixed(2)}<${cfg.minVerifiability}`);
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
          // Strategy dimensions carried from the research brief (TZ §5, §8).
          vertical: item.vertical ?? null,
          market: item.market ?? null,
          uzbekistanQuota: item.uzbekistanQuota ?? false,
          constructiveAngle: item.constructiveAngle ?? null,
          additionalSources: item.additionalSources ?? [],
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
 * Rank all NEW items and mark them SELECTED or FILTERED_OUT.
 *
 * Three gates, cheapest first:
 *   1. Deterministic source/keyword gate — no LLM cost (operator-tunable lists).
 *   2. COMPLIANCE — prohibited categories and blocking yellow-zone rules
 *      (TZ §6, §6.1). A RED verdict drops the item unconditionally: no score is
 *      high enough to publish prohibited material, so this is checked before the
 *      editorial thresholds and is never weighed against them.
 *   3. Editorial thresholds — score, relevance, constructiveness, verifiability
 *      and priority, all live-tunable from the control panel.
 *
 * Yellow-zone items are KEPT but carry their handling rules and a raised
 * approval tier, so the approval stage can require the right sign-offs.
 */
export async function rankPendingItems(): Promise<{ selected: number; dropped: number }> {
  const cfg = await getRuntimeConfig();
  const pending = await prisma.newsItem.findMany({ where: { status: "NEW" } });
  let selected = 0;
  let dropped = 0;
  let preFiltered = 0;
  let prohibited = 0;
  let yellow = 0;
  let errored = 0;

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

    // 2) Editorial ranking + compliance classification. On a transient failure,
    //    leave the item NEW so the next run retries it instead of permanently
    //    dropping a possibly-valuable story.
    let verdict: RankVerdict;
    try {
      verdict = await rankNews(item);
    } catch (err) {
      log.warn({ err, id: item.id }, "ranking failed; leaving NEW for retry");
      errored++;
      continue;
    }

    const { compliance } = verdict;

    // 3) Compliance is decisive and is evaluated on its own. Prohibited material
    //    is dropped regardless of how well it scored.
    if (compliance.zone === "RED") {
      await prisma.newsItem.update({
        where: { id: item.id },
        data: {
          score: verdict.score,
          relevance: verdict.relevance,
          constructiveness: verdict.constructiveness,
          verifiability: verdict.verifiability,
          priority: verdict.priority,
          complianceZone: "RED",
          bannedCategories: compliance.bannedCategories,
          yellowRules: compliance.yellowRules,
          approvalTier: compliance.tier,
          rankReasons: `prohibited — ${compliance.reason}`,
          status: "FILTERED_OUT",
        },
      });
      dropped++;
      prohibited++;
      continue;
    }

    const keep = meetsThresholds(verdict, cfg);
    if (keep && compliance.zone === "YELLOW") yellow++;

    await prisma.newsItem.update({
      where: { id: item.id },
      data: {
        score: verdict.score,
        relevance: verdict.relevance,
        constructiveness: verdict.constructiveness,
        verifiability: verdict.verifiability,
        priority: verdict.priority,
        complianceZone: compliance.zone,
        bannedCategories: compliance.bannedCategories,
        yellowRules: compliance.yellowRules,
        approvalTier: compliance.tier,
        rankReasons: keep
          ? `${verdict.reasons}${compliance.zone === "YELLOW" ? ` [yellow zone: ${compliance.yellowRules.join(", ")} — tier ${compliance.tier}]` : ""}`
          : dropReason(verdict, cfg),
        status: keep ? "SELECTED" : "FILTERED_OUT",
      },
    });
    keep ? selected++ : dropped++;
  }

  log.info(
    { selected, dropped, preFiltered, prohibited, yellow, errored },
    "ranking complete",
  );
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
