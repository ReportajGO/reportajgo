/**
 * Why a draft has no picture.
 *
 * Both review lists used to fetch READY assets only, so a draft whose image
 * failed looked exactly like a draft whose image was still rendering: an empty
 * box with a dash. The reason existed — MediaAsset.error — but only the worker
 * log ever saw it, which left the operator staring at a blank card with no way
 * to tell "not finished yet" from "image generation is broken".
 */

/** The MediaAsset columns the review lists read. */
export const MEDIA_FOR_REVIEW = {
  select: { type: true, url: true, aspectRatio: true, status: true, error: true },
} as const;

export interface ReviewMedia {
  type: string;
  url: string | null;
  aspectRatio: string;
  status: string;
  error: string | null;
}

export interface MediaIssue {
  /** FAILED, or the in-flight status (QUEUED / GENERATING). */
  status: string;
  /** Provider error for a failure; null while it is still working. */
  error: string | null;
}

/**
 * Narrow a draft's assets to the ones a reviewer can actually see, and when
 * there are none, attach the reason as `mediaIssue`.
 */
export function withMediaState<T extends { media: ReviewMedia[] }>(
  draft: T,
): Omit<T, "media"> & { media: ReviewMedia[]; mediaIssue: MediaIssue | null } {
  const ready = draft.media.filter((m) => m.status === "READY" && m.url);
  if (ready.length > 0) return { ...draft, media: ready, mediaIssue: null };

  // Newest first, so a retry's outcome wins over the attempt before it.
  const failed = draft.media.find((m) => m.status === "FAILED");
  const working = draft.media.find((m) => m.status === "GENERATING" || m.status === "QUEUED");
  const mediaIssue: MediaIssue | null = failed
    ? { status: "FAILED", error: failed.error ?? "image generation failed" }
    : working
      ? { status: working.status, error: null }
      : null;

  return { ...draft, media: ready, mediaIssue };
}
