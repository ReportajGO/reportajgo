import { logger } from "../config/logger.js";
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
  drafts: number;
}> {
  log.info("research pipeline start");

  const researched = await researchAllTopics();
  const insertedIds = await persistNewItems(researched);
  const { selected, dropped } = await rankPendingItems();
  const { drafts } = await draftSelectedItems();

  const summary = {
    researched: researched.length,
    inserted: insertedIds.length,
    selected,
    dropped,
    drafts,
  };
  log.info(summary, "research pipeline complete");
  return summary;
}
