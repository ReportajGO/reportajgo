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
    include: { draft: { include: { media: true, newsItem: true } } },
  });

  if (!sp) {
    log.warn({ scheduledPostId }, "scheduled post not found");
    return;
  }
  if (sp.status === "PUBLISHED") {
    log.info({ scheduledPostId }, "already published; skipping");
    return;
  }
  if (sp.status === "CANCELLED") {
    log.info({ scheduledPostId }, "post cancelled; skipping");
    return;
  }

  const news = sp.draft.newsItem;
  const platform = sp.platform as Platform;

  // Website-first: a social post must wait until its website sibling is live so
  // it can link back to the full article. If the website post for this story
  // hasn't published yet, fail this attempt — BullMQ retries with backoff, by
  // which time the website job has run.
  let articleUrl: string | undefined;
  let articleBody: string | undefined;
  if (platform !== "WEBSITE" && news) {
    // The social post carries the WEBSITE article's text + link, so load the
    // website sibling draft (its body) and gate on its publish having happened.
    const websiteDraft = await prisma.postDraft.findFirst({
      where: { platform: "WEBSITE", newsItemId: news.id },
      select: { body: true, scheduledPost: { select: { status: true } } },
    });
    const websiteStatus = websiteDraft?.scheduledPost?.status;
    // Only wait while the website post is still IN PROGRESS. If it FAILED or was
    // CANCELLED it will never become PUBLISHED, so publish the social post anyway
    // (just without the article link) instead of retrying forever.
    const inProgress = new Set(["PENDING", "PUBLISHING", "SCHEDULED"]);
    if (websiteStatus && inProgress.has(websiteStatus)) {
      log.info({ scheduledPostId, websiteStatus }, "waiting for website publish");
      throw new Error("waiting for website article to publish before social post");
    }
    articleUrl = news.websiteUrl ?? undefined;
    articleBody = websiteDraft?.body ?? undefined;
  }

  await prisma.scheduledPost.update({
    where: { id: sp.id },
    data: { status: "PUBLISHING", attempts: { increment: 1 } },
  });

  try {
    const media = sp.draft.media
      .filter((m) => m.status === "READY" && m.url)
      .map((m) => ({ type: m.type as MediaType, url: m.url! }));

    const publisher = getPublisher(platform);
    const result = await publisher.publish({
      platform,
      // Social posts carry the website article's body; website uses its own.
      body: articleBody ?? sp.draft.body,
      hashtags: sp.draft.hashtags,
      media,
      articleUrl,
      article: news
        ? {
            title: sp.draft.headline?.trim() || news.title,
            excerpt: news.summary,
            language: sp.draft.language,
            topic: news.topic ?? undefined,
            source: news.sourceName ?? undefined,
            sourceUrl: news.sourceUrl,
            dedupeKey: news.contentHash,
          }
        : undefined,
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
      // Record the live article URL so social siblings can link back to it.
      ...(platform === "WEBSITE" && result.url && news
        ? [prisma.newsItem.update({ where: { id: news.id }, data: { websiteUrl: result.url } })]
        : []),
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
