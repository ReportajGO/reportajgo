import { Worker } from "bullmq";
import { logger } from "../config/logger.js";
import { getRuntimeConfig, isResearchPaused } from "../config/settingsStore.js";
import { publishAllPending } from "../dashboard/controlService.js";
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
    async (job) => {
      // "run now" (manual) always runs; scheduled/auto runs honor the pause flag.
      const manual =
        job.name === "research-manual" ||
        Boolean((job.data as { manual?: boolean } | undefined)?.manual);
      // Read the flag fresh from the DB (not the cache) so a pause set by the
      // dashboard/bot — possibly in another process — is seen mid-run.
      const isPaused = async () => !manual && (await isResearchPaused());

      if (await isPaused()) {
        log.info({ jobId: job.id }, "research paused; skipping scheduled run");
        return { skipped: "paused" };
      }

      // The pipeline re-checks isPaused() at each stage boundary and stops early
      // if the operator pauses mid-run (before the slow drafting/media steps).
      const research = await runResearchPipeline({ cancelled: isPaused });
      if (await isPaused()) {
        log.info({ jobId: job.id }, "paused during research; skipping media/publish");
        return { ...research, paused: true };
      }

      const media = await generateMediaForPendingDrafts();
      // Auto-publish mode ("share itself"): approve + publish everything ready,
      // no human approval step.
      const { autoPublish } = await getRuntimeConfig();
      if (autoPublish && !(await isPaused())) {
        const published = await publishAllPending("auto");
        log.info({ items: published.items }, "auto-published ready stories");
        return { ...research, ...media, autoPublished: published.items };
      }
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
