import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import type { Platform } from "../domain/types.js";
import { type Publisher, type PublishInput, type PublishResult } from "./publisher.js";

const log = logger.child({ module: "publish:meta" });

const GRAPH = `https://graph.facebook.com/${env.META_GRAPH_VERSION}`;

// Instagram captions allow up to 2200 chars. The full website article fits in
// a single post (image + caption). No links — Instagram captions don't make
// them clickable anyway.
const META_CAPTION_CAP = 2200;

/**
 * Long, website-style Instagram/Facebook caption: headline + the full website
 * article body + hashtags. One post, no links. Trimmed to Instagram's cap.
 */
export function buildMetaCaption(input: PublishInput): string {
  const headline = input.article?.title?.trim();
  const parts: string[] = [];

  if (headline) parts.push(headline);
  if (input.body.trim()) parts.push(input.body.trim());
  const tags = input.hashtags.map((h) => `#${h.replace(/^#/, "").trim()}`).filter((t) => t.length > 1);
  if (tags.length) parts.push(tags.join(" "));

  let caption = parts.join("\n\n");
  if (caption.length > META_CAPTION_CAP) caption = `${caption.slice(0, META_CAPTION_CAP - 1)}…`;
  return caption;
}

/** POST to a Graph endpoint with form params; throws on API error. */
async function graphPost(path: string, params: Record<string, string>): Promise<any> {
  const token = env.META_ACCESS_TOKEN;
  if (!token) throw new Error("META_ACCESS_TOKEN is not set");
  const body = new URLSearchParams({ ...params, access_token: token });
  const res = await fetch(`${GRAPH}/${path}`, { method: "POST", body });
  const json = (await res.json()) as { error?: { message?: string } } & Record<string, any>;
  if (!res.ok || json.error) {
    throw new Error(`Graph API error: ${json.error?.message ?? res.statusText}`);
  }
  return json;
}

/**
 * Instagram (Business/Creator) image post via the two-step container + publish
 * flow. Requires an image_url reachable by Meta (our Higgsfield URLs are public).
 */
export class InstagramPublisher implements Publisher {
  readonly platform: Platform = "INSTAGRAM";

  async publish(input: PublishInput): Promise<PublishResult> {
    const igId = env.META_IG_BUSINESS_ID;
    if (!igId) throw new Error("META_IG_BUSINESS_ID is not set");
    const image = input.media.find((m) => m.type === "IMAGE");
    if (!image) throw new Error("Instagram requires an image");

    const container = await graphPost(`${igId}/media`, {
      image_url: image.url,
      caption: buildMetaCaption(input),
    });
    const published = await graphPost(`${igId}/media_publish`, {
      creation_id: container.id,
    });
    log.info({ id: published.id }, "published to instagram");
    return { externalPostId: String(published.id) };
  }
}

/** Facebook Page photo (or text) post. */
export class FacebookPublisher implements Publisher {
  readonly platform: Platform = "FACEBOOK";

  async publish(input: PublishInput): Promise<PublishResult> {
    const pageId = env.META_FB_PAGE_ID;
    if (!pageId) throw new Error("META_FB_PAGE_ID is not set");
    const caption = buildMetaCaption(input);
    const image = input.media.find((m) => m.type === "IMAGE");

    if (image) {
      const res = await graphPost(`${pageId}/photos`, { url: image.url, caption });
      log.info({ id: res.post_id ?? res.id }, "published photo to facebook");
      return { externalPostId: String(res.post_id ?? res.id) };
    }
    const res = await graphPost(`${pageId}/feed`, { message: caption });
    log.info({ id: res.id }, "published text to facebook");
    return { externalPostId: String(res.id) };
  }
}
