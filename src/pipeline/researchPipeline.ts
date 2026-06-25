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
export async function runResearchPipeline(): Promise<{
  researched: number;
  inserted: number;
  selected: number;
  dropped: number;
  deduped: number;
  drafts: number;
}> {
  log.info("research pipeline start");

  const researched = await researchAllTopics();
  const insertedIds = await persistNewItems(researched);
  const { selected, dropped } = await rankPendingItems();
  // Collapse the same story reported by multiple outlets into one before drafting.
  const { merged: deduped } = await dedupeSelectedItems();
  const { drafts } = await draftSelectedItems();

  const summary = {
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
