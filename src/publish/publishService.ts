import { logger } from "../config/logger.js";
import { prisma } from "../db/client.js";
import type { MediaType, Platform } from "../domain/types.js";
import { getPublisher } from "./registry.js";

const log = logger.child({ module: "publish" });

/**
 * Publish one ScheduledPost. Loads the draft + its READY media, calls the
 * platform publisher, and records the result. Safe to retry: a FAILED post can
 * be re-enqueued; attempts are tracked.
 */
export async function publishScheduledPost(scheduledPostId: string): Promise<void> {
  const sp = await prisma.scheduledPost.findUnique({
    where: { id: scheduledPostId },
    include: { draft: { include: { media: true } } },
  });

  if (!sp) {
    log.warn({ scheduledPostId }, "scheduled post not found");
    return;
  }
  if (sp.status === "PUBLISHED") {
    log.info({ scheduledPostId }, "already published; skipping");
    return;
  }

  await prisma.scheduledPost.update({
    where: { id: sp.id },
    data: { status: "PUBLISHING", attempts: { increment: 1 } },
  });

  try {
    const media = sp.draft.media
      .filter((m) => m.status === "READY" && m.url)
      .map((m) => ({ type: m.type as MediaType, url: m.url! }));

    const publisher = getPublisher(sp.platform as Platform);
    const result = await publisher.publish({
      platform: sp.platform as Platform,
      body: sp.draft.body,
      hashtags: sp.draft.hashtags,
      media,
    });

    await prisma.$transaction([
      prisma.scheduledPost.update({
        where: { id: sp.id },
        data: {
          status: "PUBLISHED",
          publishedAt: new Date(),
          externalPostId: result.externalPostId,
          error: null,
        },
      }),
      prisma.postDraft.update({ where: { id: sp.draftId }, data: { status: "PUBLISHED" } }),
    ]);

    log.info({ scheduledPostId, externalPostId: result.externalPostId }, "published");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ scheduledPostId, err: message }, "publish failed");
    await prisma.scheduledPost.update({
      where: { id: sp.id },
      data: { status: "FAILED", error: message },
    });
    throw err; // let BullMQ apply its retry/backoff policy
  }
}
