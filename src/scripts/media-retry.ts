/**
 * SCRIPT 4 — recover drafts that died while image generation was broken.
 *
 * When the image provider fails, generateMediaForPendingDrafts() marks the draft
 * FAILED. Nothing in the pipeline ever moves a draft back out of FAILED, so once
 * the provider is fixed those stories stay dead — the news item silently never
 * gets a post. This requeues them so the next research run regenerates media.
 *
 * SAFE BY DEFAULT: prints what it would requeue and changes nothing. Regenerating
 * costs provider credits, so requeuing is opt-in with --apply.
 *
 *   # see what's recoverable (no changes, no credits spent)
 *   npx tsx src/scripts/media-retry.ts
 *   npx tsx src/scripts/media-retry.ts --news <newsItemId>
 *
 *   # requeue them (the research worker picks up PENDING_MEDIA on its next run)
 *   npx tsx src/scripts/media-retry.ts --apply
 *   npx tsx src/scripts/media-retry.ts --apply --limit 5
 *
 *   # requeue AND generate right now instead of waiting for the worker
 *   npx tsx src/scripts/media-retry.ts --apply --now
 *
 * In PRODUCTION (Docker, compiled dist/) run it in the worker container, which
 * holds the media provider credentials:
 *   docker compose exec backend-worker npm run media:retry:prod
 *   docker compose exec backend-worker npm run media:retry:prod -- --apply --now
 */
import { prisma } from "../db/client.js";
import { restoreDraft } from "../dashboard/approvalService.js";

// Bound one run so a large backlog can't burn the whole provider quota at once.
const DEFAULT_LIMIT = 25;

function arg(name: string): string | undefined {
  const flag = `--${name}`;
  const i = process.argv.indexOf(flag);
  if (i !== -1) return process.argv[i + 1] && !process.argv[i + 1]!.startsWith("--") ? process.argv[i + 1] : "";
  const eq = process.argv.find((a) => a.startsWith(`${flag}=`));
  return eq ? eq.slice(flag.length + 1) : undefined;
}
const has = (name: string): boolean => process.argv.includes(`--${name}`);

/**
 * Drafts that failed at the MEDIA step, as opposed to the publish step: only
 * mediaService marks a PostDraft FAILED (publish failures land on ScheduledPost),
 * but require no schedule and no usable asset so a draft that failed after
 * approval is never dragged back into the pipeline.
 */
async function findMediaFailedDrafts(newsItemId?: string) {
  const drafts = await prisma.postDraft.findMany({
    where: {
      status: "FAILED",
      scheduledPost: { is: null },
      ...(newsItemId ? { newsItemId } : {}),
    },
    include: {
      media: { select: { status: true, url: true, error: true, createdAt: true } },
      newsItem: { select: { id: true, title: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return drafts.filter((d) => !d.media.some((m) => m.status === "READY" && m.url));
}

/** Last recorded provider error for a draft — the reason it's in this list. */
function lastError(media: { error: string | null; createdAt: Date }[]): string {
  const withError = media.filter((m) => m.error).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const message = withError[0]?.error;
  if (!message) return "no asset error recorded (failed before the provider call)";
  return message.length > 120 ? `${message.slice(0, 120)}…` : message;
}

async function main(): Promise<void> {
  const newsItemId = arg("news") || undefined;
  const limitArg = arg("limit");
  const limit = limitArg ? Number(limitArg) : DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1) throw new Error(`--limit must be a positive integer, got "${limitArg}"`);

  const candidates = await findMediaFailedDrafts(newsItemId);
  if (candidates.length === 0) {
    console.log("✅ Nothing to recover — no drafts are stuck in FAILED from a media failure.");
    return;
  }

  const batch = candidates.slice(0, limit);
  console.log(`\n🩹 ${candidates.length} draft(s) failed at the media step; showing ${batch.length}:\n`);
  for (const d of batch) {
    console.log(`   • ${d.platform}  ${d.newsItem.title.slice(0, 60)}`);
    console.log(`     draft ${d.id} · news ${d.newsItem.id}`);
    console.log(`     why: ${lastError(d.media)}`);
  }
  if (candidates.length > batch.length) {
    console.log(`\n   … ${candidates.length - batch.length} more (raise --limit to include them).`);
  }

  if (!has("apply")) {
    console.log("\n🔎 Dry run — nothing changed. Re-run with --apply to requeue these drafts.");
    return;
  }

  // restoreDraft owns the FAILED → PENDING_MEDIA transition and also clears
  // approvalSentAt, so the Telegram sweep sends a fresh card once media lands.
  let requeued = 0;
  let failed = 0;
  for (const d of batch) {
    try {
      const updated = await restoreDraft(d.id);
      console.log(`   ↻ ${d.id} → ${updated.status}`);
      requeued++;
    } catch (err) {
      console.log(`   ❌ ${d.id} → ${(err as Error).message}`);
      failed++;
    }
  }
  console.log(`\n✅ requeued: ${requeued}${failed ? `, failed: ${failed}` : ""}`);

  if (has("now")) {
    console.log("\n🖼️  Generating media now …");
    const { generateMediaForPendingDrafts } = await import("../generate/media/mediaService.js");
    const res = await generateMediaForPendingDrafts(newsItemId ? { newsItemId } : undefined);
    console.log(`   ready: ${res.ready}, failed: ${res.failed}`);
    if (res.failed > 0) {
      console.log("   ⚠  some drafts failed again — check the provider before retrying the rest.");
    }
  } else {
    console.log("   The research worker regenerates PENDING_MEDIA on its next run.");
    console.log("   To generate immediately instead: re-run with --now (or `npm run gen:images`).");
  }
}

main()
  .catch((err) => {
    console.error("\n❌ media-retry failed:", err?.message ?? err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
