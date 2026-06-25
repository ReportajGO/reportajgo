import { logger } from "../config/logger.js";
import { prisma } from "../db/client.js";
import { publishQueue } from "../queue/queues.js";

const log = logger.child({ module: "scheduler" });

// Retry policy for publish jobs (transient platform/API failures).
const PUBLISH_ATTEMPTS = 3;
const BACKOFF_MS = 30_000;

/**
 * Find ScheduledPosts whose time has arrived and enqueue a publish job for each.
 * Uses the scheduled-post id as the BullMQ jobId so repeated scans never
 * double-enqueue the same post while a job is still in flight.
 */
export async function scanDueAndEnqueue(): Promise<number> {
  const now = new Date();
  const due = await prisma.scheduledPost.findMany({
    where: { status: "PENDING", scheduledAt: { lte: now } },
    select: { id: true },
  });

  for (const sp of due) {
    await publishQueue.add(
      "publish",
      { scheduledPostId: sp.id },
      {
        jobId: sp.id,
        attempts: PUBLISH_ATTEMPTS,
        backoff: { type: "exponential", delay: BACKOFF_MS },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );
  }

  if (due.length) log.info({ due: due.length }, "enqueued due posts");
  return due.length;
}
