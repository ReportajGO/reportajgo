import { existsSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { logger } from "../../config/logger.js";
import type { Platform } from "../../domain/types.js";
import { MEDIA_ROOT } from "../../generate/media/mediaStore.js";
import { buildMetaCaption } from "../meta.js";
import type { Publisher, PublishInput, PublishResult } from "../publisher.js";
import { postToInstagram } from "./post.js";

const log = logger.child({ module: "publish:instagram-web" });

/** Resolve a media URL to a local file path, downloading remote URLs to temp. */
async function toLocalPath(url: string, isVideo: boolean): Promise<string> {
  const marker = "/media/";
  const idx = url.indexOf(marker);
  if (idx !== -1) {
    const path = join(MEDIA_ROOT, url.slice(idx + marker.length));
    if (existsSync(path)) return path;
  }
  // Remote URL — download to a temp file Playwright can upload.
  const res = await fetch(url);
  if (!res.ok) throw new Error(`failed to download media for Instagram: HTTP ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const dir = await mkdtemp(join(tmpdir(), "ig-web-"));
  const lower = url.toLowerCase();
  const ext = isVideo
    ? lower.includes(".mov") ? "mov" : lower.includes(".webm") ? "webm" : "mp4"
    : lower.includes(".png") ? "png" : "jpg";
  const path = join(dir, `post.${ext}`);
  await writeFile(path, bytes);
  return path;
}

/**
 * Publishes to Instagram by automating the instagram.com web "Create" flow
 * (persistent logged-in Chrome profile) instead of the Meta Graph API. Posts a
 * VIDEO as a Reel when the draft carries one, otherwise an image feed post.
 */
export class InstagramWebPublisher implements Publisher {
  readonly platform: Platform = "INSTAGRAM";

  async publish(input: PublishInput): Promise<PublishResult> {
    // Prefer video → Reel; fall back to the image feed post.
    const video = input.media.find((m) => m.type === "VIDEO");
    const image = input.media.find((m) => m.type === "IMAGE");
    const media = video ?? image;
    if (!media) throw new Error("Instagram web publisher needs an image or video");
    const isVideo = Boolean(video);

    const filePath = await toLocalPath(media.url, isVideo);
    const caption = buildMetaCaption(input);
    const { url } = await postToInstagram({ filePath, caption, isVideo });

    // Derive a post id from the permalink shortcode (/p/ or /reel/) when found.
    const shortcode = url?.match(/\/(?:p|reel)\/([^/]+)/)?.[1];
    const externalPostId = shortcode ?? `web-${input.article?.dedupeKey ?? "post"}`;
    log.info({ externalPostId, url, reel: isVideo }, "instagram web publish complete");
    return { externalPostId, url };
  }
}
