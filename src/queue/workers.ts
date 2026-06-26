import { Worker } from "bullmq";
import { logger } from "../config/logger.js";
import { generateMediaForPendingDrafts } from "../generate/media/mediaService.js";
import { runResearchPipeline } from "../pipeline/researchPipeline.js";
import { publishScheduledPost } from "../publish/publishService.js";
import { deleteStaleNews } from "../scheduler/cleanup.js";
import { scanDueAndEnqueue } from "../scheduler/scanner.js";
import { QUEUE_NAMES, connection } from "./connection.js";
import type { PublishJobData } from "./queues.js";

const log = logger.child({ module: "workers" });

/**
 * Start all queue processors in this process. Returns the workers so callers
 * can close them on shutdown.
 */
export function startWorkers(): Worker[] {

  // Full content pipeline: research -> filter -> copy -> media.
  const pipeline = new Worker(
    QUEUE_NAMES.pipeline,
    async () => {
      const research = await runResearchPipeline();
      const media = await generateMediaForPendingDrafts();
      return { ...research, ...media };
    },
    { connection },
  );

  // Publish one due post.
  const publish = new Worker<PublishJobData>(
    QUEUE_NAMES.publish,
    async (job) => publishScheduledPost(job.data.scheduledPostId),
    { connection },
  );

  // Scan for due posts (enqueue publishes) and purge stale news each tick.
  const scheduler = new Worker(
    QUEUE_NAMES.scheduler,
    async () => {
      await deleteStaleNews();
      return scanDueAndEnqueue();
    },
    { connection },
  );

  const all = [pipeline, publish, scheduler];
  for (const w of all) {
    w.on("failed", (job, err) =>
      log.error({ queue: w.name, jobId: job?.id, err: err.message }, "job failed"),
    );
    w.on("completed", (job) => log.debug({ queue: w.name, jobId: job.id }, "job done"));
  }
  log.info("workers started");
  return all;
}
