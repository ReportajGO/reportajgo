/**
 * The policy half of media self-healing: which failed drafts get another go.
 *
 * Kept free of env/db imports so the rules that decide how many provider
 * credits an outage can cost are unit-testable on their own — mediaRecovery.ts
 * holds the database side.
 */

/** How long an asset may sit in GENERATING before we call it interrupted. */
export const STALLED_AFTER_MS = 20 * 60_000;
/** Quiet period after a failure, so a flapping provider isn't hammered. */
export const RETRY_COOLDOWN_MS = 30 * 60_000;
/** Ceiling on requeues per sweep, so a backlog drains steadily, not all at once. */
export const MAX_REQUEUE_PER_RUN = 10;

export interface RetryCandidate {
  id: string;
  /** Every generation run leaves exactly one asset row, so this counts attempts. */
  media: { status: string; url: string | null }[];
}

/**
 * Failed drafts worth retrying: nothing usable yet, and attempt budget left.
 * The budget is the safety valve — past it a draft stays FAILED and waits for a
 * human, which is the honest signal that something is actually broken.
 */
export function pickDraftsToRequeue(
  candidates: RetryCandidate[],
  maxAttempts: number,
  maxPerRun: number,
): string[] {
  return candidates
    .filter((d) => !d.media.some((m) => m.status === "READY" && m.url))
    .filter((d) => d.media.length < maxAttempts)
    .slice(0, maxPerRun)
    .map((d) => d.id);
}
