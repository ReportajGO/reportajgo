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

// Reels container processing is async: poll status_code until FINISHED before
// publishing. Meta typically finishes a short clip in 10-60s.
const REEL_POLL_INTERVAL_MS = 4000;
const REEL_POLL_MAX_ATTEMPTS = 60; // ~4 min ceiling

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

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

function requireToken(): string {
  const token = env.META_ACCESS_TOKEN;
  if (!token) throw new Error("META_ACCESS_TOKEN is not set");
  return token;
}

/** POST to a Graph endpoint with form params; throws on API error. */
async function graphPost(path: string, params: Record<string, string>): Promise<any> {
  const body = new URLSearchParams({ ...params, access_token: requireToken() });
  const res = await fetch(`${GRAPH}/${path}`, { method: "POST", body });
  const json = (await res.json()) as { error?: { message?: string } } & Record<string, any>;
  if (!res.ok || json.error) {
    throw new Error(`Graph API error: ${json.error?.message ?? res.statusText}`);
  }
  return json;
}

/** GET a Graph endpoint with query params; throws on API error. */
async function graphGet(path: string, params: Record<string, string> = {}): Promise<any> {
  const qs = new URLSearchParams({ ...params, access_token: requireToken() });
  const res = await fetch(`${GRAPH}/${path}?${qs}`);
  const json = (await res.json()) as { error?: { message?: string } } & Record<string, any>;
  if (!res.ok || json.error) {
    throw new Error(`Graph API error: ${json.error?.message ?? res.statusText}`);
  }
  return json;
}

/**
 * Pages the current token can manage, each with its linked Instagram Business
 * account. Used to auto-discover META_FB_PAGE_ID and verify the IG link without
 * hardcoding ids. Returns [] if the token can't list pages.
 */
export interface ManagedPage {
  id: string;
  name: string;
  instagramBusinessId?: string;
}

export async function listManagedPages(): Promise<ManagedPage[]> {
  const json = await graphGet("me/accounts", {
    fields: "id,name,instagram_business_account{id,username}",
  });
  const data: any[] = Array.isArray(json.data) ? json.data : [];
  return data.map((p) => ({
    id: String(p.id),
    name: String(p.name ?? ""),
    instagramBusinessId: p.instagram_business_account?.id
      ? String(p.instagram_business_account.id)
      : undefined,
  }));
}

/** Poll a Reels media container until it finishes processing (or fails). */
async function waitForContainer(containerId: string): Promise<void> {
  for (let attempt = 0; attempt < REEL_POLL_MAX_ATTEMPTS; attempt++) {
    const status = await graphGet(containerId, { fields: "status_code,status" });
    const code = String(status.status_code ?? "");
    if (code === "FINISHED") return;
    if (code === "ERROR" || code === "EXPIRED") {
      throw new Error(`Reels container ${code}: ${status.status ?? "unknown"}`);
    }
    await sleep(REEL_POLL_INTERVAL_MS);
  }
  throw new Error("Reels container did not finish processing in time");
}

/**
 * Instagram (Business/Creator) post via the two-step container + publish flow.
 * Publishes a Reel when the draft carries a VIDEO (the 15s AI-anchor clip),
 * otherwise a feed image. Media URLs must be publicly reachable by Meta (our
 * Higgsfield/CDN URLs are public).
 */
export class InstagramPublisher implements Publisher {
  readonly platform: Platform = "INSTAGRAM";

  async publish(input: PublishInput): Promise<PublishResult> {
    const igId = env.META_IG_BUSINESS_ID;
    if (!igId) throw new Error("META_IG_BUSINESS_ID is not set");

    const caption = buildMetaCaption(input);
    const video = input.media.find((m) => m.type === "VIDEO");
    if (video) return this.publishReel(igId, video.url, caption);

    const image = input.media.find((m) => m.type === "IMAGE");
    if (!image) throw new Error("Instagram requires an image or video");
    return this.publishImage(igId, image.url, caption);
  }

  private async publishImage(igId: string, imageUrl: string, caption: string): Promise<PublishResult> {
    const container = await graphPost(`${igId}/media`, { image_url: imageUrl, caption });
    const published = await graphPost(`${igId}/media_publish`, { creation_id: container.id });
    log.info({ id: published.id }, "published image to instagram");
    return { externalPostId: String(published.id) };
  }

  private async publishReel(igId: string, videoUrl: string, caption: string): Promise<PublishResult> {
    const container = await graphPost(`${igId}/media`, {
      media_type: "REELS",
      video_url: videoUrl,
      caption,
      share_to_feed: "true",
    });
    log.info({ container: container.id }, "instagram reel container created, processing…");
    await waitForContainer(String(container.id));
    const published = await graphPost(`${igId}/media_publish`, { creation_id: container.id });
    log.info({ id: published.id }, "published reel to instagram");
    return { externalPostId: String(published.id) };
  }
}

