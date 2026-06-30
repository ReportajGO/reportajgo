import { logger } from "../config/logger.js";
import { prisma } from "../db/client.js";
import { approveDraft } from "../dashboard/approvalService.js";
import { scanNow } from "../dashboard/controlService.js";
import { contentHash } from "../filter/hash.js";
import { draftNewsItem } from "../generate/copy/copyService.js";
import { generateMediaForPendingDrafts } from "../generate/media/mediaService.js";
import { researchUrl } from "../research/researchService.js";

const log = logger.child({ module: "instant-post" });

export type InstantStage = "reading" | "drafting" | "media" | "publishing";
export type ProgressFn = (stage: InstantStage) => void;

export interface InstantPostResult {
  newsItemId: string;
  title: string;
  /** Platforms that got a ready, scheduled post. */
  platforms: string[];
  draftsReady: number;
  draftsFailed: number;
}

export interface PublishState {
  platform: string;
  status: string;
  error: string | null;
  externalPostId: string | null;
}

/**
 * Operator-driven instant post: take ONE news URL, build per-platform posts +
 * images with the normal agent pipeline, then auto-approve and publish them
 * right away (no approval card). Returns once publishing has been triggered;
 * the actual publish runs in the publish worker (poll getPublishState for the
 * outcome).
 */
export async function instantPostFromUrl(
  url: string,
  opts: { approver?: string; onProgress?: ProgressFn } = {},
): Promise<InstantPostResult> {
  const progress = opts.onProgress ?? (() => {});

  // 1) Read the specific article behind the link.
  progress("reading");
  const news = await researchUrl(url);

  // 2) Persist as a SELECTED news item, reusing an existing row for the same
  //    content (so re-submitting a link refreshes instead of erroring).
  progress("drafting");
  const hash = contentHash(news);
  const existing = await prisma.newsItem.findUnique({ where: { contentHash: hash } });
  const item = existing
    ? await prisma.newsItem.update({
        where: { id: existing.id },
        data: {
          status: "SELECTED",
          title: news.title,
          summary: news.summary,
          sourceName: news.sourceName ?? null,
          topic: news.topic ?? null,
          language: news.language,
        },
      })
    : await prisma.newsItem.create({
        data: {
          title: news.title,
          summary: news.summary,
          sourceUrl: news.sourceUrl,
          sourceName: news.sourceName ?? null,
          language: news.language,
          topic: news.topic ?? null,
          publishedAt: news.publishedAt ?? null,
          contentHash: hash,
          score: 1,
          relevance: 1,
          rankReasons: "manual url submission",
          status: "SELECTED",
        },
      });

  // Clear any stale unpublished drafts from a previous attempt on this item so
  // we rebuild fresh copy/media (PUBLISHED drafts are kept).
  await prisma.postDraft.deleteMany({
    where: { newsItemId: item.id, status: { in: ["PENDING_MEDIA", "FAILED", "PENDING_APPROVAL"] } },
  });

  // 3) Per-platform copy for every enabled platform.
  const { drafts } = await draftNewsItem(item.id);
  if (drafts === 0) throw new Error("failed to generate any post copy");

  // 4) Images / branded cards — for THIS item only.
  progress("media");
  const { ready, failed } = await generateMediaForPendingDrafts({ newsItemId: item.id });
  if (ready === 0) throw new Error("media generation failed for all posts");

  // 5) Auto-approve (schedule for now) — approveDraft cascades to every ready
  //    sibling of the item — then trigger an immediate publish scan.
  progress("publishing");
  const readyDrafts = await prisma.postDraft.findMany({
    where: { newsItemId: item.id, status: "PENDING_APPROVAL" },
    select: { id: true, platform: true },
  });
  if (readyDrafts.length === 0) throw new Error("no posts became ready to publish");

  await approveDraft(readyDrafts[0]!.id, {
    scheduledAt: new Date().toISOString(),
    approver: opts.approver ?? "instant-url",
  });
  await scanNow();

  log.info({ newsItemId: item.id, ready, failed }, "instant post approved + publishing");
  return {
    newsItemId: item.id,
    title: item.title,
    platforms: readyDrafts.map((d) => d.platform),
    draftsReady: ready,
    draftsFailed: failed,
  };
}

/** Current publish status per platform for a news item (for progress polling). */
export async function getPublishState(newsItemId: string): Promise<PublishState[]> {
  const rows = await prisma.scheduledPost.findMany({
    where: { draft: { newsItemId } },
    select: {
      status: true,
      error: true,
      externalPostId: true,
      draft: { select: { platform: true } },
    },
  });
  return rows.map((r) => ({
    platform: r.draft.platform,
    status: r.status,
    error: r.error,
    externalPostId: r.externalPostId,
  }));
}
