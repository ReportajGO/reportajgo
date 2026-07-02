import { env } from "../config/env.js";
import { getRuntimeConfig, setResearchPaused } from "../config/settingsStore.js";
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
  const { researchCron, researchPaused } = await getRuntimeConfig();
  await clearResearchRepeat();
  // Respect a persisted pause: don't re-arm the research cron on boot, otherwise
  // a restart would silently resume research the operator had stopped.
  if (!researchPaused) {
    await pipelineQueue.add(
      RESEARCH_JOB,
      {},
      { repeat: { pattern: researchCron, tz: env.TZ }, removeOnComplete: true },
    );
  }
  await schedulerQueue.add(
    "scan",
    {},
    { repeat: { every: SCAN_INTERVAL_MS }, removeOnComplete: true },
  );
  log.info({ cron: researchCron, tz: env.TZ, researchPaused }, "repeatable jobs registered");
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

/**
 * Pause automatic research: persist the paused flag (so it survives restarts and
 * every in-process consumer sees it), remove the repeatable job, and drop any
 * pipeline jobs already waiting/delayed so no new run starts. An in-flight run
 * checks the flag at each stage boundary and stops before drafting/media.
 */
export async function pauseResearchCron(): Promise<void> {
  await setResearchPaused(true);
  await clearResearchRepeat();
  // Remove queued (waiting + delayed) pipeline jobs; active jobs can't be
  // removed but will short-circuit on the paused flag.
  await pipelineQueue.drain(true);
  log.info("research cron paused");
}

/** Resume automatic research using the current settings cron. */
export async function resumeResearchCron(): Promise<void> {
  await setResearchPaused(false);
  const { researchCron } = await getRuntimeConfig();
  await reRegisterResearchCron(researchCron);
}

/** Whether the repeatable research job is currently registered. */
export async function isResearchCronActive(): Promise<boolean> {
  const repeatables = await pipelineQueue.getRepeatableJobs();
  return repeatables.some((r) => r.name === RESEARCH_JOB);
}
