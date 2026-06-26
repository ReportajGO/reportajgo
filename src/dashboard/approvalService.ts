import { logger } from "../config/logger.js";
import { prisma } from "../db/client.js";

const log = logger.child({ module: "approval" });

/** Drafts awaiting human review, with their media + source news. */
export async function listPendingDrafts() {
  return prisma.postDraft.findMany({
    where: { status: "PENDING_APPROVAL" },
    include: {
      media: { where: { status: "READY" }, select: { type: true, url: true, aspectRatio: true } },
      newsItem: { select: { title: true, sourceName: true, sourceUrl: true, topic: true } },
    },
    orderBy: { createdAt: "asc" },
  });
}

export interface ApproveInput {
  body?: string;
  hashtags?: string[];
  scheduledAt: string; // ISO 8601
  approver?: string;
}

/**
 * Approve a draft (optionally with edited copy) and schedule it.
 * Creates/replaces the ScheduledPost so the scanner will publish it.
 */
export async function approveDraft(draftId: string, input: ApproveInput) {
  const when = new Date(input.scheduledAt);
  if (Number.isNaN(when.getTime())) throw new Error("invalid scheduledAt");

  const draft = await prisma.postDraft.findUnique({ where: { id: draftId } });
  if (!draft) throw new Error("draft not found");

  const updated = await prisma.postDraft.update({
    where: { id: draftId },
    data: {
      ...(input.body !== undefined ? { body: input.body } : {}),
      ...(input.hashtags !== undefined ? { hashtags: input.hashtags } : {}),
      status: "SCHEDULED",
      approvedBy: input.approver ?? null,
      approvedAt: new Date(),
      rejectedReason: null,
    },
  });

  await prisma.scheduledPost.upsert({
    where: { draftId },
    create: { draftId, platform: draft.platform, scheduledAt: when, status: "PENDING" },
    update: { scheduledAt: when, status: "PENDING", error: null },
  });

  log.info({ draftId, scheduledAt: when.toISOString() }, "draft approved + scheduled");
  return updated;
}

export async function rejectDraft(draftId: string, reason?: string) {
  const updated = await prisma.postDraft.update({
    where: { id: draftId },
    data: { status: "REJECTED", rejectedReason: reason ?? null },
  });
  // Cancel any pending schedule.
  await prisma.scheduledPost.updateMany({
    where: { draftId, status: "PENDING" },
    data: { status: "CANCELLED" },
  });
  log.info({ draftId }, "draft rejected");
  return updated;
}

/**
 * Restore a REJECTED/FAILED draft back into the pipeline. If its media is ready
 * it returns to PENDING_APPROVAL for review; otherwise to PENDING_MEDIA so the
 * media worker regenerates it. Any pending/failed schedule is cancelled.
 */
export async function restoreDraft(draftId: string) {
  const draft = await prisma.postDraft.findUnique({
    where: { id: draftId },
    include: { media: true },
  });
  if (!draft) throw new Error("draft not found");

  const hasReadyMedia = draft.media.some((m) => m.status === "READY" && m.url);
  const next = hasReadyMedia ? "PENDING_APPROVAL" : "PENDING_MEDIA";

  const updated = await prisma.postDraft.update({
    where: { id: draftId },
    data: { status: next, rejectedReason: null, approvedAt: null, approvedBy: null, approvalSentAt: null },
  });
  await prisma.scheduledPost.updateMany({
    where: { draftId, status: { in: ["PENDING", "FAILED"] } },
    data: { status: "CANCELLED" },
  });
  log.info({ draftId, next }, "draft restored");
  return updated;
}

/**
 * Reschedule a post to a new time. Re-arms the ScheduledPost (status PENDING,
 * error cleared) so the scanner picks it up, and keeps the draft in SCHEDULED.
 * Works for SCHEDULED posts (change the time) and FAILED ones (retry later).
 */
export async function reschedulePost(draftId: string, scheduledAt: string) {
  const when = new Date(scheduledAt);
  if (Number.isNaN(when.getTime())) throw new Error("invalid scheduledAt");

  const draft = await prisma.postDraft.findUnique({ where: { id: draftId } });
  if (!draft) throw new Error("draft not found");

  const sp = await prisma.scheduledPost.upsert({
    where: { draftId },
    create: { draftId, platform: draft.platform, scheduledAt: when, status: "PENDING" },
    update: { scheduledAt: when, status: "PENDING", error: null, publishedAt: null },
  });
  if (draft.status !== "SCHEDULED") {
    await prisma.postDraft.update({ where: { id: draftId }, data: { status: "SCHEDULED" } });
  }
  log.info({ draftId, scheduledAt: when.toISOString() }, "post rescheduled");
  return sp;
}
