import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { prisma } from "../db/client.js";

const log = logger.child({ module: "cleanup" });

/**
 * Delete news items older than the retention window. Their drafts, media assets
 * and scheduled posts cascade-delete with them (see schema onDelete: Cascade),
 * keeping the agent database lean. Already-published website articles are stored
 * in the website's own DB and are NOT affected.
 */
export async function deleteStaleNews(): Promise<{ deleted: number }> {
  const cutoff = new Date(Date.now() - env.NEWS_RETENTION_HOURS * 60 * 60 * 1000);
  const res = await prisma.newsItem.deleteMany({ where: { fetchedAt: { lt: cutoff } } });
  if (res.count > 0) {
    log.info({ deleted: res.count, olderThanHours: env.NEWS_RETENTION_HOURS }, "stale news purged");
  }
  return { deleted: res.count };
}
