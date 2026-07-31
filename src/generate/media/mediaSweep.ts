import { logger } from "../../config/logger.js";
import { tryWithLock } from "../../queue/lock.js";
import { generateMediaForPendingDrafts } from "./mediaService.js";

const log = logger.child({ module: "media-sweep" });

const MEDIA_LOCK_KEY = "reportajgo:media:sweep";
// Purely a CRASH timeout — tryWithLock heartbeats the key for as long as the
// sweep is actually running, so the lock no longer has to out-guess how long a
// backlog takes. (It used to: a 15-minute TTL against real generation times of
// several minutes per image meant a 25-draft backlog lost the lock mid-pass and
// the next 90-second tick started a second sweep over the same drafts.)
const MEDIA_LOCK_TTL_MS = 5 * 60_000;

/**
 * Generate media for ALL PENDING_MEDIA drafts, guarded by a Redis lock so the
 * periodic media worker and the research pipeline never sweep at the same time
 * (which would double-spend image-provider credits and create duplicate assets).
 * If another sweep already holds the lock, this call is a cheap no-op.
 *
 * This is the decoupled entry point that keeps media flowing even when research
 * is paused or its pipeline job isn't running — the reason drafts used to pile
 * up in PENDING_MEDIA forever.
 */
export async function sweepPendingMedia(): Promise<{
  ready: number;
  failed: number;
  skipped?: boolean;
}> {
  const outcome = await tryWithLock(MEDIA_LOCK_KEY, MEDIA_LOCK_TTL_MS, () =>
    generateMediaForPendingDrafts(),
  );
  if (!outcome.ran) {
    log.debug("media sweep skipped — another sweep holds the lock");
    return { ready: 0, failed: 0, skipped: true };
  }
  return outcome.result;
}
