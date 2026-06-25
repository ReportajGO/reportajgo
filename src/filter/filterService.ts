import { logger } from "../config/logger.js";
import { prisma } from "../db/client.js";
import type { ResearchedNews } from "../domain/types.js";
import { contentHash } from "./hash.js";
import { rankNews } from "./rank.js";

const log = logger.child({ module: "filter" });

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

/** Rank all NEW items and mark them SELECTED or FILTERED_OUT. */
export async function rankPendingItems(): Promise<{ selected: number; dropped: number }> {
  const pending = await prisma.newsItem.findMany({ where: { status: "NEW" } });
  let selected = 0;
  let dropped = 0;

  for (const item of pending) {
    const verdict = await rankNews(item);
    await prisma.newsItem.update({
      where: { id: item.id },
      data: {
        score: verdict.score,
        relevance: verdict.relevance,
        rankReasons: verdict.reasons,
        status: verdict.keep ? "SELECTED" : "FILTERED_OUT",
      },
    });
    verdict.keep ? selected++ : dropped++;
  }

  log.info({ selected, dropped }, "ranking complete");
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
