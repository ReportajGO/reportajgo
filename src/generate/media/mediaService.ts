import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { prisma } from "../../db/client.js";
import { profileFor } from "../../domain/platforms.js";
import type { AspectRatio, Platform } from "../../domain/types.js";
import type { MediaResult } from "../../domain/types.js";
import { imageHasText } from "../../research/gemini.js";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderNewsCard } from "./card.js";
import { renderTemplateCard } from "./templateCard.js";
import { renderWithCanva } from "./canva/render.js";
import { getMediaProvider } from "./index.js";
import { saveImage } from "./mediaStore.js";
import { composePrompt, describeScene } from "./prompts.js";
import { downloadImage, findArticleImageUrl } from "./sourceImage.js";
import { safeFetch } from "../../util/ssrf.js";

const log = logger.child({ module: "media" });

// Pure-image rule appended for website visuals so any provider (incl. the
// Gemini fallback) returns a clean photo with no rendered text or logos.
const PURE_IMAGE_RULE =
  "No text, no words, no letters, no captions, no subtitles, no signage, no labels, " +
  "no watermark, no logos anywhere in the image. Clean photographic image only.";

/** Fetch an image URL (local or remote) into a Buffer for compositing. */
async function fetchImageBytes(url: string): Promise<Buffer> {
  // SSRF-safe: rejects internal/loopback targets and re-checks redirects.
  const res = await safeFetch(url);
  if (!res.ok) throw new Error(`failed to fetch background image: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
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

  const purePrompt = `${prompt} ${PURE_IMAGE_RULE}`;
  let img = await generatePure(provider, purePrompt, ratio);
  for (let attempt = 2; attempt <= WORDLESS_ATTEMPTS; attempt++) {
    if (img.status !== "READY" || !img.url) break;
    if (!(await urlHasText(img.url))) break;
    log.info({ attempt }, "image still had words; regenerating for a clean one");
    img = await generatePure(provider, purePrompt, ratio);
  }
  if (img.status !== "READY" || !img.url) return null;
  return { bytes: await fetchImageBytes(img.url), mime: "image/png", provider: img.provider };
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
// How many times to regenerate a website image while words are still detected.
const WORDLESS_ATTEMPTS = 3;

/** Generate an image with Higgsfield, retrying transient failures. No Gemini. */
async function generatePure(
  provider: ReturnType<typeof getMediaProvider>,
  prompt: string,
  ratio: AspectRatio,
): Promise<MediaResult> {
  let img = await provider.generateImage({ prompt, aspectRatio: ratio });
  for (let attempt = 2; attempt <= IMAGE_GEN_ATTEMPTS && img.status !== "READY"; attempt++) {
    log.warn({ provider: provider.name, err: img.error, attempt }, "Higgsfield image failed; retrying");
    img = await provider.generateImage({ prompt, aspectRatio: ratio });
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

/** Text-detection on an image URL; never throws. */
async function urlHasText(url: string): Promise<boolean> {
  try {
    const bytes = await fetchImageBytes(url);
    const mime = url.toLowerCase().endsWith(".jpg") || url.toLowerCase().endsWith(".jpeg")
      ? "image/jpeg"
      : "image/png";
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

  for (const draft of drafts) {
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

    try {
      const scene = await describeScene(draft.newsItem);

      // Always produce a key image (also the still for video platforms).
      const imagePrompt = composePrompt(scene, "IMAGE");
      const image = await persistAsset(draft.id, "IMAGE", ratio, imagePrompt, provider.name, () =>
        isWebsite
          ? generateWebsiteImage(provider, draft.newsItem.sourceUrl, imagePrompt, ratio)
          : generateBrandedImage(provider, draft.newsItem.sourceUrl, imagePrompt, ratio, headline),
      );

      if (profile.media.type === "VIDEO") {
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

      await prisma.postDraft.update({
        where: { id: draft.id },
        data: { status: "PENDING_APPROVAL" },
      });
      ready++;
    } catch (err) {
      log.error({ err, draftId: draft.id }, "media generation failed for draft");
      await prisma.postDraft.update({
        where: { id: draft.id },
        data: { status: "FAILED" },
      });
      failed++;
    }
  }

  log.info({ ready, failed }, "media generation complete");
  return { ready, failed };
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

  const result = await generate();

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
