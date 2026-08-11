import type { NewsItem, PostDraft } from "@prisma/client";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { prisma } from "../../db/client.js";
import { platformsWithoutRequiredMedia, profileFor } from "../../domain/platforms.js";
import { tryWithLock } from "../../queue/lock.js";
import type { AspectRatio, Platform } from "../../domain/types.js";
import type { MediaResult } from "../../domain/types.js";
import { imageHasText } from "../../research/gemini.js";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PURE_IMAGE_ESCALATION } from "./brandStyle.js";
import { renderNewsCard } from "./card.js";
import { renderTemplateCard } from "./templateCard.js";
import { renderWithCanva } from "./canva/render.js";
import { getMediaProvider } from "./index.js";
import { saveImage } from "./mediaStore.js";
import { composePrompt, describeScene } from "./prompts.js";
import { downloadImage, findArticleImageUrl } from "./sourceImage.js";
import { safeFetch } from "../../util/ssrf.js";

const log = logger.child({ module: "media" });

type DraftWithNews = PostDraft & { newsItem: NewsItem };
type DraftOutcome = "ready" | "failed" | "skipped";

// Per-draft exclusivity for the whole of that draft's generation. Generous
// enough to cover a slow image + optional video + the wordless retries, and
// heartbeat-renewed by tryWithLock while the work is actually in flight — so the
// TTL only matters if the process dies holding it.
const DRAFT_CLAIM_PREFIX = "reportajgo:media:draft:";
const DRAFT_CLAIM_TTL_MS = 10 * 60_000;


/** Fetch an image URL (local or remote) into bytes + its real content type. */
async function fetchImage(url: string): Promise<{ bytes: Buffer; mime: string }> {
  // SSRF-safe: rejects internal/loopback targets and re-checks redirects.
  const res = await safeFetch(url);
  if (!res.ok) throw new Error(`failed to fetch background image: HTTP ${res.status}`);
  const declared = (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  return {
    bytes: Buffer.from(await res.arrayBuffer()),
    mime: declared.startsWith("image/") ? declared : "image/png",
  };
}

/**
 * Acquire a clean, WORDLESS background photo (used by both website images and
 * branded cards — the photo must never carry baked-in/garbled text):
 *  1. Prefer the real source article photo, but only if it's text-free.
 *  2. Otherwise generate one, regenerating until no words are detected.
 * Returns null when nothing usable was produced.
 */
async function wordlessBackground(
  provider: ReturnType<typeof getMediaProvider>,
  sourceUrl: string | undefined,
  prompt: string,
  ratio: AspectRatio,
): Promise<{ bytes: Buffer; mime: string; provider: string } | null> {
  if (sourceUrl) {
    const found = await findArticleImageUrl(sourceUrl);
    if (found) {
      const img = await downloadImage(found);
      if (img && !(await hasText(img.bytes, img.mime))) {
        log.info({ from: found }, "using source news photo (no text)");
        return { bytes: img.bytes, mime: img.mime, provider: "source" };
      }
      if (img) log.info({ from: found }, "source photo has text; generating a clean image instead");
    }
  }

  // Each retry restates the no-text rule more forcefully and uses a fresh seed,
  // so we aren't just re-rolling the same prompt and hoping.
  let candidate: { bytes: Buffer; mime: string; provider: string } | null = null;
  for (let attempt = 0; attempt < WORDLESS_ATTEMPTS; attempt++) {
    const escalation = PURE_IMAGE_ESCALATION[Math.min(attempt, PURE_IMAGE_ESCALATION.length - 1)]!;
    const img = await generatePure(provider, `${prompt} ${escalation}`.trim(), ratio);
    if (img.status !== "READY" || !img.url) continue;
    // Fetch once and check those same bytes — the old path downloaded the image
    // twice, once to inspect and once to keep.
    const fetched = await fetchImage(img.url);
    const photo = { ...fetched, provider: img.provider };
    if (!(await hasText(photo.bytes, photo.mime))) return photo;
    log.warn({ attempt: attempt + 1 }, "generated image still had words; regenerating");
    candidate ??= photo;
  }

  // Every attempt tripped the text detector. It is a useful filter but not a
  // reliable judge — it flags an ordinary street sign in a documentary photo —
  // so treating its verdict as fatal meant most stories were published with no
  // picture at all. Keep the first candidate and say so in the log; the prompt
  // itself already forbids captions, watermarks and broadcast graphics, and the
  // headline is composited by our own card template afterwards.
  if (candidate) {
    log.warn(
      { attempts: WORDLESS_ATTEMPTS, provider: candidate.provider },
      "no provably wordless image; using the best candidate rather than failing the draft",
    );
    return candidate;
  }

  log.error({ attempts: WORDLESS_ATTEMPTS }, "image generation produced nothing usable; giving up");
  return null;
}

/** Website visual policy: a clean, wordless photo with NO logo/headline overlay. */
export async function generateWebsiteImage(
  provider: ReturnType<typeof getMediaProvider>,
  sourceUrl: string,
  prompt: string,
  ratio: AspectRatio,
): Promise<MediaResult> {
  const photo = await wordlessBackground(provider, sourceUrl, prompt, ratio);
  if (!photo) {
    return { provider: provider.name, type: "IMAGE", aspectRatio: ratio, status: "FAILED", error: "image generation failed" };
  }
  const stored = await saveImage(photo.bytes, photo.mime);
  return { provider: photo.provider, type: "IMAGE", aspectRatio: ratio, url: stored.url, status: "READY" };
}

const IMAGE_GEN_ATTEMPTS = 3;
// How many times to regenerate an image while words are still detected on it.
const WORDLESS_ATTEMPTS = 3;

/** A fresh seed per attempt, so a retry actually re-rolls the composition. */
const randomSeed = () => Math.floor(Math.random() * 1_000_000_000);

/** Generate an image with Higgsfield, retrying transient failures. No Gemini. */
async function generatePure(
  provider: ReturnType<typeof getMediaProvider>,
  prompt: string,
  ratio: AspectRatio,
): Promise<MediaResult> {
  const req = { prompt, aspectRatio: ratio };
  let img = await provider.generateImage({ ...req, seed: randomSeed() });
  for (let attempt = 2; attempt <= IMAGE_GEN_ATTEMPTS && img.status !== "READY"; attempt++) {
    log.warn({ provider: provider.name, err: img.error, attempt }, "Higgsfield image failed; retrying");
    img = await provider.generateImage({ ...req, seed: randomSeed() });
  }
  return img;
}

/** Text-detection on raw bytes; never throws (fail-open = treat as no text). */
async function hasText(bytes: Buffer, mime: string): Promise<boolean> {
  try {
    return await imageHasText(bytes.toString("base64"), mime);
  } catch {
    return false;
  }
}

/**
 * Acquire a clean wordless background photo, then composite it into the branded
 * card (template / built-in / Canva). The headline is the ONLY text on the card.
 */
async function generateBrandedImage(
  provider: ReturnType<typeof getMediaProvider>,
  sourceUrl: string,
  prompt: string,
  ratio: AspectRatio,
  headline: string,
): Promise<MediaResult> {
  const photo = await wordlessBackground(provider, sourceUrl, prompt, ratio);
  if (!photo) {
    return { provider: provider.name, type: "IMAGE", aspectRatio: ratio, status: "FAILED", error: "image generation failed" };
  }

  if (!env.BRAND_CARD_ENABLED) {
    const stored = await saveImage(photo.bytes, photo.mime);
    return { provider: photo.provider, type: "IMAGE", aspectRatio: ratio, url: stored.url, status: "READY" };
  }

  // Pick the card renderer: template reproduction, original built-in, or Canva.
  const renderer = env.CARD_RENDERER;
  const cardBuf =
    renderer === "canva"
      ? await renderCanvaCard(photo.bytes, headline)
      : renderer === "template"
        ? await renderTemplateCard({ background: photo.bytes, headline })
        : await renderNewsCard({ background: photo.bytes, headline });
  const stored = await saveImage(cardBuf, "image/png");
  log.info({ url: stored.url, renderer, photo: photo.provider }, "branded card composited");
  return { provider: `${photo.provider}+${renderer}`, type: "IMAGE", aspectRatio: ratio, url: stored.url, status: "READY" };
}

/** Write the background photo to a temp file and run it through the Canva template. */
async function renderCanvaCard(bg: Buffer, headline: string): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), "canva-bg-"));
  const path = join(dir, "bg.png");
  await writeFile(path, bg);
  return renderWithCanva({ headline, imagePath: path });
}

/**
 * Generate media for every PENDING_MEDIA draft and advance it to
 * PENDING_APPROVAL (or FAILED). For video platforms we first generate a key
 * image, then animate it (Higgsfield DoP is image-to-video).
 */
export async function generateMediaForPendingDrafts(opts?: {
  newsItemId?: string;
}): Promise<{
  ready: number;
  failed: number;
}> {
  if (!env.MEDIA_GENERATION_ENABLED) {
    const textOnlyPlatforms = platformsWithoutRequiredMedia();
    const promoted = await prisma.postDraft.updateMany({
      where: {
        status: "PENDING_MEDIA",
        platform: { in: textOnlyPlatforms },
        ...(opts?.newsItemId ? { newsItemId: opts.newsItemId } : {}),
      },
      data: { status: "PENDING_APPROVAL" },
    });
    log.info({ ready: promoted.count, failed: 0 }, "media generation disabled; promoted drafts to approval");
    return { ready: promoted.count, failed: 0 };
  }

  const drafts = await prisma.postDraft.findMany({
    where: {
      status: "PENDING_MEDIA",
      ...(opts?.newsItemId ? { newsItemId: opts.newsItemId } : {}),
    },
    include: { newsItem: true },
  });

  const provider = getMediaProvider();
  let ready = 0;
  let failed = 0;
  let skipped = 0;

  for (const draft of drafts) {
    // Claim the draft for the duration of ITS generation. The sweep-wide lock
    // already serialises whole sweeps, but this is what actually makes double
    // generation impossible: any other caller (a second sweep, the instant-post
    // path, a manual retry script) finds the draft claimed and moves on instead
    // of paying for the same image a second time.
    const claim = await tryWithLock(`${DRAFT_CLAIM_PREFIX}${draft.id}`, DRAFT_CLAIM_TTL_MS, () =>
      generateForDraft(draft, provider),
    );
    if (!claim.ran) {
      log.info({ draftId: draft.id }, "draft already claimed by another media run; skipping");
      skipped++;
      continue;
    }
    if (claim.result === "ready") ready++;
    else if (claim.result === "failed") failed++;
    else skipped++;
  }

  log.info({ ready, failed, skipped }, "media generation complete");
  return { ready, failed };
}

/** One draft's media, start to finish. Runs under that draft's claim. */
async function generateForDraft(
  draft: DraftWithNews,
  provider: ReturnType<typeof getMediaProvider>,
): Promise<DraftOutcome> {
  // Re-read under the claim: another run may have finished this draft while we
  // were still working through the list we snapshotted at the top of the sweep.
  const current = await prisma.postDraft.findUnique({
    where: { id: draft.id },
    select: { status: true },
  });
  if (current?.status !== "PENDING_MEDIA") return "skipped";

  const profile = profileFor(draft.platform as Platform);
  // Website uses PURE images (real news photo or clean generated image, no
  // overlay) at the platform's natural ratio. Other platforms use the branded
  // card at the fixed card ratio (when enabled).
  const isWebsite = draft.platform === "WEBSITE";
  const ratio = (isWebsite || !env.BRAND_CARD_ENABLED
    ? profile.media.aspectRatio
    : env.BRAND_CARD_RATIO) as AspectRatio;
  // Themed card headline (post language); fall back to the source title.
  const headline = (draft.headline?.trim() || draft.newsItem.title.trim());
  const needsVideo = profile.media.type === "VIDEO";

  // Second line of defence, and the one that survives a restart: usable media
  // already on the draft means the work is done — advance, don't regenerate.
  if (await hasUsableMedia(draft.id, needsVideo)) {
    log.info({ draftId: draft.id }, "draft already has media; advancing without regenerating");
    await prisma.postDraft.update({ where: { id: draft.id }, data: { status: "PENDING_APPROVAL" } });
    return "ready";
  }

  try {
    const scene = await describeScene(draft.newsItem);

    // Always produce a key image (also the still for video platforms).
    const imagePrompt = composePrompt(scene, "IMAGE");
    const image = await persistAsset(draft.id, "IMAGE", ratio, imagePrompt, provider.name, () =>
      isWebsite
        ? generateWebsiteImage(provider, draft.newsItem.sourceUrl, imagePrompt, ratio)
        : generateBrandedImage(provider, draft.newsItem.sourceUrl, imagePrompt, ratio, headline),
    );

    if (needsVideo) {
      if (image.status !== "READY" || !image.url) {
        throw new Error("key image failed; cannot animate to video");
      }
      const videoPrompt = composePrompt(scene, "VIDEO");
      await persistAsset(draft.id, "VIDEO", ratio, videoPrompt, provider.name, () =>
        provider.generateVideo({
          prompt: videoPrompt,
          aspectRatio: ratio,
          sourceImageUrl: image.url!,
        }),
      );
    }

    // persistAsset records a failed generation as a FAILED asset and returns
    // normally, so an unchecked failure here would advance the draft to
    // PENDING_APPROVAL with no usable media. For platforms that can't post
    // without media that draft is unapprovable — fail it explicitly (the
    // VIDEO branch above already does) so it surfaces instead of piling up.
    if (image.status !== "READY" && profile.mediaRequired) {
      throw new Error(`image generation failed and ${draft.platform} requires media`);
    }

    await prisma.postDraft.update({ where: { id: draft.id }, data: { status: "PENDING_APPROVAL" } });
    return "ready";
  } catch (err) {
    log.error({ err, draftId: draft.id }, "media generation failed for draft");
    await prisma.postDraft.update({ where: { id: draft.id }, data: { status: "FAILED" } });
    return "failed";
  }
}

/** Does this draft already carry the media it needs (from an earlier run)? */
async function hasUsableMedia(draftId: string, needsVideo: boolean): Promise<boolean> {
  const assets = await prisma.mediaAsset.findMany({
    where: { draftId, status: "READY", url: { not: null } },
    select: { type: true },
  });
  const hasImage = assets.some((a) => a.type === "IMAGE");
  return needsVideo ? hasImage && assets.some((a) => a.type === "VIDEO") : hasImage;
}

/** Create a QUEUED MediaAsset row, run the generator, then persist the result. */
async function persistAsset(
  draftId: string,
  type: "IMAGE" | "VIDEO",
  aspectRatio: AspectRatio,
  prompt: string,
  providerName: string,
  generate: () => Promise<{
    status: string;
    url?: string;
    externalJobId?: string;
    error?: string;
    provider: string;
  }>,
) {
  const asset = await prisma.mediaAsset.create({
    data: { draftId, type, provider: providerName, aspectRatio, prompt, status: "GENERATING" },
  });

  let result: Awaited<ReturnType<typeof generate>>;
  try {
    result = await generate();
  } catch (err) {
    // The generator can throw as well as return a FAILED result — a network
    // error fetching the finished image, the SSRF guard, the provider SDK. That
    // used to leave the row in GENERATING forever, which reads as "still
    // working" to every retry path and hides the real error. Record it, then
    // rethrow so the draft is failed by the caller as before.
    await prisma.mediaAsset.update({
      where: { id: asset.id },
      data: { status: "FAILED", error: err instanceof Error ? err.message : String(err) },
    });
    throw err;
  }

  await prisma.mediaAsset.update({
    where: { id: asset.id },
    data: {
      status: result.status === "READY" ? "READY" : "FAILED",
      url: result.url ?? null,
      externalJobId: result.externalJobId ?? null,
      error: result.error ?? null,
      provider: result.provider,
    },
  });

  return result;
}
