/**
 * Self-healing for the media pipeline.
 *
 * Two failure modes used to require a human with SSH access before a single
 * picture appeared again:
 *
 *  1. An asset stuck in GENERATING. The worker is killed on every deploy, and
 *     whatever it was rendering at that moment stays "in progress" forever —
 *     nothing ever transitions it, so the draft looks busy and its attempt is
 *     never counted.
 *  2. A draft parked in FAILED. Only a manual `npm run media:retry -- --apply`
 *     ever moved a draft out of FAILED, so an outage that lasted an hour left a
 *     pile of stories that would never get an image, however healthy the
 *     provider became afterwards.
 *
 * Recovery is deliberately BOUNDED: regenerating costs provider credits, so a
 * systemic outage must cost a fixed number of attempts rather than an unbounded
 * retry loop. Each draft gets MEDIA_AUTO_RETRY_MAX_ATTEMPTS generation runs in
 * total (counted by its MediaAsset rows — every run leaves exactly one), after
 * a cooldown, capped per sweep. Past that budget the draft stays FAILED and
 * waits for an operator, which is the honest signal that something is wrong.
 */
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { prisma } from "../../db/client.js";
import { restoreDraft } from "../../dashboard/approvalService.js";
import {
  MAX_REQUEUE_PER_RUN,
  RETRY_COOLDOWN_MS,
  STALLED_AFTER_MS,
  pickDraftsToRequeue,
} from "./retryPolicy.js";

const log = logger.child({ module: "media-recovery" });

/**
 * Fail assets abandoned mid-generation. Their draft is still PENDING_MEDIA, so
 * the next sweep regenerates it — this just stops the row lying about being in
 * progress, and makes the attempt count honest.
 */
async function failStalledAssets(): Promise<number> {
  const { count } = await prisma.mediaAsset.updateMany({
    where: {
      status: "GENERATING",
      updatedAt: { lt: new Date(Date.now() - STALLED_AFTER_MS) },
    },
    data: {
      status: "FAILED",
      error: "generation interrupted (worker restarted or the provider never answered)",
    },
  });
  if (count > 0) log.warn({ count }, "released assets stuck in GENERATING");
  return count;
}

/** Move recoverable FAILED drafts back to PENDING_MEDIA, within budget. */
async function requeueFailedDrafts(): Promise<number> {
  const candidates = await prisma.postDraft.findMany({
    where: {
      status: "FAILED",
      // Publish failures live on ScheduledPost; only media failures are ours.
      scheduledPost: { is: null },
      updatedAt: { lt: new Date(Date.now() - RETRY_COOLDOWN_MS) },
    },
    select: { id: true, media: { select: { status: true, url: true } } },
    orderBy: { updatedAt: "asc" },
    take: MAX_REQUEUE_PER_RUN * 4,
  });

  const ids = pickDraftsToRequeue(candidates, env.MEDIA_AUTO_RETRY_MAX_ATTEMPTS, MAX_REQUEUE_PER_RUN);
  let requeued = 0;
  for (const id of ids) {
    try {
      // restoreDraft owns the FAILED -> PENDING_MEDIA transition and clears
      // approvalSentAt, so the Telegram card is re-sent once media lands.
      await restoreDraft(id);
      requeued++;
    } catch (err) {
      log.warn({ err, draftId: id }, "could not requeue failed draft");
    }
  }
  if (requeued > 0) {
    const exhausted = candidates.length - ids.length;
    log.info(
      { requeued, exhausted, maxAttempts: env.MEDIA_AUTO_RETRY_MAX_ATTEMPTS },
      "auto-recovered drafts that failed at the media step",
    );
  }
  return requeued;
}

/**
 * Run both repairs. Called at the top of every media sweep, inside the sweep
 * lock, so exactly one process is repairing at a time.
 */
export async function recoverStalledMedia(): Promise<{ released: number; requeued: number }> {
  if (!env.MEDIA_AUTO_RETRY_ENABLED) return { released: 0, requeued: 0 };
  try {
    const released = await failStalledAssets();
    const requeued = await requeueFailedDrafts();
    return { released, requeued };
  } catch (err) {
    // Recovery is best-effort: never let it stop the sweep that follows it.
    log.error({ err }, "media recovery pass failed");
    return { released: 0, requeued: 0 };
  }
}
