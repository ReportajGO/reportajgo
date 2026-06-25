import { env } from "../config/env.js";
import { getRuntimeConfig } from "../config/settingsStore.js";
import { logger } from "../config/logger.js";
import { pipelineQueue, schedulerQueue } from "./queues.js";

const log = logger.child({ module: "schedule" });

const SCAN_INTERVAL_MS = 60_000;
const RESEARCH_JOB = "research";

/** Remove any existing repeatable research job(s) so we can re-add cleanly. */
async function clearResearchRepeat(): Promise<void> {
  const repeatables = await pipelineQueue.getRepeatableJobs();
  await Promise.all(
    repeatables
      .filter((r) => r.name === RESEARCH_JOB)
      .map((r) => pipelineQueue.removeRepeatableByKey(r.key)),
  );
}

/**
 * Register the repeatable jobs that drive the system:
 *  - pipeline: research+media on the configured cron
 *  - scheduler: scan for due posts every minute
 * Idempotent — clears any stale research repeat first so a changed cron in
 * settings takes effect on boot.
 */
export async function registerRepeatableJobs(): Promise<void> {
  const { researchCron } = await getRuntimeConfig();
  await clearResearchRepeat();
  await pipelineQueue.add(
    RESEARCH_JOB,
    {},
    { repeat: { pattern: researchCron, tz: env.TZ }, removeOnComplete: true },
  );
  await schedulerQueue.add(
    "scan",
    {},
    { repeat: { every: SCAN_INTERVAL_MS }, removeOnComplete: true },
  );
  log.info({ cron: researchCron, tz: env.TZ }, "repeatable jobs registered");
}

/** Re-point the research cron to a new pattern (used after a settings change). */
export async function reRegisterResearchCron(pattern: string): Promise<void> {
  await clearResearchRepeat();
  await pipelineQueue.add(
    RESEARCH_JOB,
    {},
    { repeat: { pattern, tz: env.TZ }, removeOnComplete: true },
  );
  log.info({ cron: pattern, tz: env.TZ }, "research cron re-registered");
}

/** Pause automatic research by removing the repeatable job. */
export async function pauseResearchCron(): Promise<void> {
  await clearResearchRepeat();
  log.info("research cron paused");
}

/** Resume automatic research using the current settings cron. */
export async function resumeResearchCron(): Promise<void> {
  const { researchCron } = await getRuntimeConfig();
  await reRegisterResearchCron(researchCron);
}

/** Whether the repeatable research job is currently registered. */
export async function isResearchCronActive(): Promise<boolean> {
  const repeatables = await pipelineQueue.getRepeatableJobs();
  return repeatables.some((r) => r.name === RESEARCH_JOB);
}
