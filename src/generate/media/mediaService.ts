import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { prisma } from "../../db/client.js";
import { profileFor } from "../../domain/platforms.js";
import type { AspectRatio, Platform } from "../../domain/types.js";
import type { MediaResult } from "../../domain/types.js";
import { renderNewsCard } from "./card.js";
import { GeminiImageProvider } from "./geminiImage.js";
import { getMediaProvider } from "./index.js";
import { saveImage } from "./mediaStore.js";
import { composePrompt, describeScene } from "./prompts.js";
import { downloadImage, findArticleImageUrl } from "./sourceImage.js";

const log = logger.child({ module: "media" });

// Pure-image rule appended for website visuals so any provider (incl. the
// Gemini fallback) returns a clean photo with no rendered text or logos.
const PURE_IMAGE_RULE =
  "No text, no words, no letters, no captions, no subtitles, no signage, no labels, " +
  "no watermark, no logos anywhere in the image. Clean photographic image only.";

/** Fetch an image URL (local or remote) into a Buffer for compositing. */
async function fetchImageBytes(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`failed to fetch background image: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Website visual policy: use a PURE image (no logo/headline overlay).
 *  1. Prefer the real news photo from the source article (re-hosted locally).
 *  2. Otherwise generate a clean image (Higgsfield, Gemini fallback) with no
 *     text or logos.
 */
async function generateWebsiteImage(
  provider: ReturnType<typeof getMediaProvider>,
  sourceUrl: string,
  prompt: string,
  ratio: AspectRatio,
): Promise<MediaResult> {
  // 1. Real news photo, if the article exposes one.
  const found = await findArticleImageUrl(sourceUrl);
  if (found) {
    const img = await downloadImage(found);
    if (img) {
      const stored = await saveImage(img.bytes, img.mime);
      log.info({ url: stored.url, from: found }, "using source news photo (pure)");
      return { provider: "source", type: "IMAGE", aspectRatio: ratio, url: stored.url, status: "READY" };
    }
  }

  // 2. Generate a pure image. NO card compositing → no logo/headline.
  const purePrompt = `${prompt} ${PURE_IMAGE_RULE}`;
  let img = await provider.generateImage({ prompt: purePrompt, aspectRatio: ratio });
  if (img.status !== "READY" && provider.name !== "gemini") {
    log.warn({ provider: provider.name, err: img.error }, "primary image provider failed; falling back to Gemini");
    img = await new GeminiImageProvider().generateImage({ prompt: purePrompt, aspectRatio: ratio });
  }
  return img;
}

/**
 * Generate the background image, then (when enabled) composite it into the
 * branded news card: GO logo + red accent bar + uppercase headline. Returns a
 * MediaResult pointing at the final card.
 */
async function generateBrandedImage(
  provider: ReturnType<typeof getMediaProvider>,
  prompt: string,
  ratio: AspectRatio,
  headline: string,
) {
  let bg = await provider.generateImage({ prompt, aspectRatio: ratio });

  // If the primary provider (e.g. Higgsfield) fails — out of credits, outage —
  // fall back to Gemini so the post still gets an image. Once the primary is
  // healthy again it's used automatically.
  if (bg.status !== "READY" && provider.name !== "gemini") {
    log.warn({ provider: provider.name, err: bg.error }, "primary image provider failed; falling back to Gemini");
    bg = await new GeminiImageProvider().generateImage({ prompt, aspectRatio: ratio });
  }

  if (!env.BRAND_CARD_ENABLED || bg.status !== "READY" || !bg.url) return bg;

  const bgBytes = await fetchImageBytes(bg.url);
  const cardBuf = await renderNewsCard({ background: bgBytes, headline });
  const stored = await saveImage(cardBuf, "image/png");
  log.info({ url: stored.url }, "branded card composited");
  return { ...bg, url: stored.url, provider: `${bg.provider}+card` };
}

/**
 * Generate media for every PENDING_MEDIA draft and advance it to
 * PENDING_APPROVAL (or FAILED). For video platforms we first generate a key
 * image, then animate it (Higgsfield DoP is image-to-video).
 */
export async function generateMediaForPendingDrafts(): Promise<{
  ready: number;
  failed: number;
}> {
  const drafts = await prisma.postDraft.findMany({
    where: { status: "PENDING_MEDIA" },
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
          : generateBrandedImage(provider, imagePrompt, ratio, headline),
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
