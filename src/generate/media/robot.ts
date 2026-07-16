// Reusable building blocks for the "image robot" CLI scripts (gen-images,
// make-card). These wrap the exact pieces the pipeline uses — Higgsfield photo
// generation + the branded card renderer — so a standalone script produces a
// pixel-identical result to `generateMediaForPendingDrafts`, without needing the
// database or the BullMQ worker.
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import type { AspectRatio } from "../../domain/types.js";
import { safeFetch } from "../../util/ssrf.js";
import { renderNewsCard } from "./card.js";
import { getMediaProvider } from "./index.js";
import { saveImage } from "./mediaStore.js";
import { renderTemplateCard } from "./templateCard.js";

const log = logger.child({ module: "media-robot" });

// Same retry budget the pipeline uses for transient Higgsfield/Cloudflare blips.
const IMAGE_GEN_ATTEMPTS = 3;

/** Download an image URL (public CloudFront/https) into bytes for compositing. */
export async function fetchImageBytes(url: string): Promise<Buffer> {
  const res = await safeFetch(url);
  if (!res.ok) throw new Error(`failed to fetch image: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

export interface NewsPhoto {
  /** Public URL of the generated Higgsfield photo. */
  url: string;
  /** The photo bytes (already downloaded, ready to composite). */
  bytes: Buffer;
  provider: string;
}

/**
 * Generate ONE clean, wordless Higgsfield photo for a fully-composed prompt.
 * Retries transient failures, then downloads the bytes. Throws if it can't get a
 * ready image after all attempts.
 */
export async function generateNewsPhoto(prompt: string, ratio: AspectRatio): Promise<NewsPhoto> {
  const provider = getMediaProvider();
  let img = await provider.generateImage({ prompt, aspectRatio: ratio });
  for (let attempt = 2; attempt <= IMAGE_GEN_ATTEMPTS && img.status !== "READY"; attempt++) {
    log.warn({ err: img.error, attempt }, "Higgsfield image failed; retrying");
    img = await provider.generateImage({ prompt, aspectRatio: ratio });
  }
  if (img.status !== "READY" || !img.url) {
    throw new Error(`Higgsfield image generation failed: ${img.error ?? "no url"}`);
  }
  return { url: img.url, bytes: await fetchImageBytes(img.url), provider: img.provider };
}

/**
 * Composite a background photo into the branded ReportajGO card. Honors
 * CARD_RENDERER: "template" (the working code reproduction of the Canva card) or
 * "builtin". The real-browser "canva" renderer is intentionally NOT used here —
 * it is brittle/broken; the template card is its pixel-matched replacement.
 */
export async function composeBrandedCard(background: Buffer, headline: string): Promise<Buffer> {
  const renderer = env.CARD_RENDERER === "builtin" ? "builtin" : "template";
  if (env.CARD_RENDERER === "canva") {
    log.warn("CARD_RENDERER=canva is broken; using the template card renderer instead");
  }
  return renderer === "builtin"
    ? renderNewsCard({ background, headline })
    : renderTemplateCard({ background, headline });
}

export interface BrandedCard {
  /** Public URL (dashboard /media path for local, or the s3 object URL). */
  cardUrl: string;
  /** Storage path: an absolute fs path (local driver) or `s3://bucket/key` (s3). */
  cardPath: string;
  filename: string;
  /** Whether cardPath is a real local file (false under the s3 driver). */
  isLocal: boolean;
  /** The raw card PNG bytes — lets callers write a local copy under any driver. */
  bytes: Buffer;
}

/** Render the branded card and persist it via the configured media store. */
export async function saveBrandedCard(background: Buffer, headline: string): Promise<BrandedCard> {
  const card = await composeBrandedCard(background, headline);
  const stored = await saveImage(card, "image/png");
  return {
    cardUrl: stored.url,
    cardPath: stored.path,
    filename: stored.filename,
    isLocal: !stored.path.startsWith("s3://"),
    bytes: card,
  };
}
