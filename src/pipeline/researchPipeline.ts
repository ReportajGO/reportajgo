import { logger } from "../config/logger.js";
import { dedupeSelectedItems } from "../filter/dedupe.js";
import { persistNewItems, rankPendingItems } from "../filter/filterService.js";
import { draftSelectedItems } from "../generate/copy/copyService.js";
import { researchAllTopics } from "../research/researchService.js";

const log = logger.child({ module: "pipeline" });

/**
 * Research + content pipeline (Phases 1-2): research every topic, dedupe +
 * persist new items, rank into SELECTED / FILTERED_OUT, then generate
 * per-platform copy drafts for selected items.
 * Returns a summary for logging/observability.
 */
interface PipelineSummary {
  researched: number;
  inserted: number;
  selected: number;
  dropped: number;
  deduped: number;
  drafts: number;
}

export async function runResearchPipeline(
  opts: { cancelled?: () => boolean | Promise<boolean> } = {},
): Promise<PipelineSummary> {
  const cancelled = opts.cancelled ?? (() => false);
  log.info("research pipeline start");

  const researched = await researchAllTopics();
  // Bail before persisting/drafting if research was paused mid-run — nothing
  // enters the system, so no new drafts or posts are produced.
  if (await cancelled()) {
    const s: PipelineSummary = {
      researched: researched.length,
      inserted: 0,
      selected: 0,
      dropped: 0,
      deduped: 0,
      drafts: 0,
    };
    log.info(s, "research pipeline cancelled (paused)");
    return s;
  }

  const insertedIds = await persistNewItems(researched);
  const { selected, dropped } = await rankPendingItems();
  // Collapse the same story reported by multiple outlets into one before drafting.
  const { merged: deduped } = await dedupeSelectedItems();

  // Drafting is the other slow (Gemini) stage — skip it if paused meanwhile.
  if (await cancelled()) {
    const s: PipelineSummary = {
      researched: researched.length,
      inserted: insertedIds.length,
      selected,
      dropped,
      deduped,
      drafts: 0,
    };
    log.info(s, "research pipeline cancelled (paused) before drafting");
    return s;
  }

  const { drafts } = await draftSelectedItems();

  const summary: PipelineSummary = {
    researched: researched.length,
    inserted: insertedIds.length,
    selected,
    dropped,
    deduped,
    drafts,
  };
  log.info(summary, "research pipeline complete");
  return summary;
}
