import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { getRuntimeConfig } from "../config/settingsStore.js";
import { prisma } from "../db/client.js";
import { profileFor } from "../domain/platforms.js";
import type { Platform } from "../domain/types.js";
import { pipelineQueue, publishQueue, schedulerQueue } from "../queue/queues.js";
import { isResearchCronActive } from "../queue/schedule.js";
import { approveDraft } from "./approvalService.js";
import type { Queue } from "bullmq";

const log = logger.child({ module: "control" });

const QUEUES: Record<string, Queue> = {
  pipeline: pipelineQueue,
  publish: publishQueue,
  scheduler: schedulerQueue,
};

interface HealthFlag {
  ok: boolean;
  detail?: string;
}

async function checkPostgres(): Promise<HealthFlag> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

async function checkRedis(): Promise<HealthFlag> {
  try {
    // BullMQ's exported client type omits raw commands; ping exists at runtime.
    const client = (await pipelineQueue.client) as unknown as { ping(): Promise<string> };
    const pong = await client.ping();
    return { ok: pong === "PONG" };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

async function queueCounts() {
  const entries = await Promise.all(
    Object.entries(QUEUES).map(async ([name, q]) => {
      try {
        const counts = await q.getJobCounts(
          "waiting",
          "active",
          "completed",
          "failed",
          "delayed",
        );
        return [name, counts] as const;
      } catch (err) {
        log.warn({ queue: name, err }, "job counts failed");
        return [name, { error: true }] as const;
      }
    }),
  );
  return Object.fromEntries(entries);
}

// Counts of drafts / scheduled posts grouped by status, returned as plain maps.
async function contentCounts() {
  const [drafts, scheduled, news] = await Promise.all([
    prisma.postDraft.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.scheduledPost.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.newsItem.count(),
  ]);
  const toMap = (rows: { status: string; _count: { _all: number } }[]) =>
    Object.fromEntries(rows.map((r) => [r.status, r._count._all]));
  return {
    drafts: toMap(drafts as never),
    scheduled: toMap(scheduled as never),
    newsItems: news,
  };
}

export async function getHealth() {
  const [postgres, redis] = await Promise.all([checkPostgres(), checkRedis()]);
  return {
    ok: postgres.ok && redis.ok,
    postgres,
    redis,
  };
}

function integrations() {
  return {
    gemini: { configured: Boolean(env.GEMINI_API_KEY), editable: false },
    telegram: {
      // The channel publisher reuses the approval-bot token when no dedicated
      // TELEGRAM_BOT_TOKEN is set, so either token counts as configured.
      configured: Boolean(
        (env.TELEGRAM_BOT_TOKEN || env.TELEGRAM_APPROVAL_BOT_TOKEN) && env.TELEGRAM_CHANNEL_ID,
      ),
      editable: false,
    },
    meta: {
      configured: Boolean(
        env.META_ACCESS_TOKEN && (env.META_IG_BUSINESS_ID || env.META_FB_PAGE_ID),
      ),
      editable: false,
    },
    higgsfield: { configured: Boolean(env.HIGGSFIELD_CREDENTIALS), editable: false },
  };
}

/** Everything the control panel needs to render in one round-trip. */
export async function getStatus() {
  const [postgres, redis, queues, content, config, cronActive] = await Promise.all([
    checkPostgres(),
    checkRedis(),
    queueCounts(),
    contentCounts(),
    getRuntimeConfig(),
    isResearchCronActive(),
  ]);

  return {
    health: {
      postgres,
      redis,
      gemini: { ok: Boolean(env.GEMINI_API_KEY) },
    },
    queues,
    content,
    config: {
      ...config,
      tz: env.TZ,
      approvers: env.approvers,
      cronActive,
    },
    integrations: integrations(),
  };
}

/** Enqueue a one-off pipeline run (research -> filter -> copy -> media). */
export async function runPipelineNow(): Promise<{ jobId?: string }> {
  // `manual` marks this as an explicit "run now" so the worker runs it even
  // while automatic research is paused.
  const job = await pipelineQueue.add("research-manual", { manual: true }, { removeOnComplete: true });
  log.info({ jobId: job.id }, "manual pipeline run enqueued");
  return { jobId: job.id };
}

/** Enqueue a one-off scan for due scheduled posts. */
export async function scanNow(): Promise<{ jobId?: string }> {
  const job = await schedulerQueue.add("scan-manual", {}, { removeOnComplete: true });
  log.info({ jobId: job.id }, "manual scan enqueued");
  return { jobId: job.id };
}

/**
 * Publish everything at once: approve + schedule every draft awaiting approval
 * (that has ready media) and trigger an immediate publish — no per-item review.
 * One approval per news item, which cascades to its platform siblings.
 */
export async function publishAllPending(
  approver = "publish-all",
): Promise<{ items: number; drafts: number; skipped: number }> {
  const pending = await prisma.postDraft.findMany({
    where: { status: "PENDING_APPROVAL" },
    select: {
      id: true,
      newsItemId: true,
      platform: true,
      media: { where: { status: "READY", url: { not: null } }, select: { id: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  // One approvable draft (with ready media) per news item — approveDraft cascades
  // to the item's other platform drafts automatically.
  const byItem = new Map<string, string>();
  for (const d of pending) {
    const canPublishTextOnly = !profileFor(d.platform as Platform).mediaRequired;
    if (
      ((!env.MEDIA_GENERATION_ENABLED && canPublishTextOnly) || d.media.length > 0) &&
      !byItem.has(d.newsItemId)
    ) {
      byItem.set(d.newsItemId, d.id);
    }
  }

  const now = new Date().toISOString();
  for (const draftId of byItem.values()) {
    await approveDraft(draftId, { scheduledAt: now, approver });
  }
  if (byItem.size > 0) await scanNow();

  const skipped = pending.length - byItem.size;
  log.info({ items: byItem.size, drafts: pending.length, skipped }, "publish-all triggered");
  return { items: byItem.size, drafts: pending.length, skipped };
}

/** Retry every failed job on a queue. */
export async function retryFailed(queueName: string): Promise<{ retried: number }> {
  const q = QUEUES[queueName];
  if (!q) throw new Error(`unknown queue: ${queueName}`);
  const failed = await q.getFailed();
  await Promise.all(failed.map((job) => job.retry()));
  log.info({ queue: queueName, retried: failed.length }, "failed jobs retried");
  return { retried: failed.length };
}

/**
 * Delete every REJECTED draft (and its media + scheduled post, via cascade).
 * Clears out the Rejected list in one action.
 */
export async function removeRejectedDrafts(): Promise<{ removed: number }> {
  const res = await prisma.postDraft.deleteMany({ where: { status: "REJECTED" } });
  log.info({ removed: res.count }, "removed rejected drafts");
  return { removed: res.count };
}

type LifecycleStatus = "PENDING_APPROVAL" | "SCHEDULED" | "PUBLISHED" | "REJECTED" | "FAILED";

/** Post drafts in a given lifecycle state, with media + source + schedule. */
export async function listPostsByStatus(status: LifecycleStatus) {
  return prisma.postDraft.findMany({
    where: { status },
    include: {
      media: { where: { status: "READY" }, select: { type: true, url: true, aspectRatio: true } },
      newsItem: { select: { title: true, sourceName: true, sourceUrl: true, topic: true } },
      scheduledPost: {
        select: { scheduledAt: true, status: true, publishedAt: true, error: true, externalPostId: true },
      },
    },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });
}
