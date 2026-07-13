import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { themeSlug } from "../domain/themes.js";
import type { Platform } from "../domain/types.js";
import type { Publisher, PublishInput, PublishResult } from "./publisher.js";

const log = logger.child({ module: "publish:website" });

// Fallback theme slug when an article carries no matched topic.
const DEFAULT_THEME = "news";

/** The theme slug an article belongs to (its matched topic filter). */
function articleTheme(topic: string | undefined): string {
  const t = (topic ?? "").trim();
  return t ? themeSlug(t) : DEFAULT_THEME;
}

// The site only renders uz/ru/en; default anything else to en.
function mapLanguage(lang: string): "uz" | "ru" | "en" {
  const l = lang.trim().toLowerCase();
  return l === "uz" || l === "ru" || l === "en" ? l : "en";
}

/** Make a media URL absolute so the website (and browsers) can fetch it. */
function absoluteUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  const base = env.PUBLIC_BASE_URL.replace(/\/+$/, "");
  return `${base}${url.startsWith("/") ? "" : "/"}${url}`;
}

interface IngestResponse {
  duplicate?: boolean;
  post?: { id?: string; language?: string };
  url?: string;
  error?: string;
}

/**
 * Publishes an approved draft to the ReportajGO website via its agent ingest
 * API (POST /api/agent/posts). The post is already human-approved (Telegram),
 * so the site publishes it live immediately.
 */
export class WebsitePublisher implements Publisher {
  readonly platform: Platform = "WEBSITE";
  private endpoint: string;
  private apiKey: string;

  constructor() {
    if (!env.WEBSITE_API_KEY) throw new Error("WEBSITE_API_KEY is not set");
    this.apiKey = env.WEBSITE_API_KEY;
    this.endpoint = `${env.WEBSITE_API_URL.replace(/\/+$/, "")}/api/agent/posts`;
  }

  async publish(input: PublishInput): Promise<PublishResult> {
    const a = input.article;
    if (!a) throw new Error("WEBSITE publish requires article metadata");
    const image = input.media.find((m) => m.type === "IMAGE" && m.url);
    const payload = {
      title: a.title,
      excerpt: a.excerpt,
      content: input.body,
      category: articleTheme(a.topic),
      language: mapLanguage(a.language),
      ...(image?.url ? { imageUrl: absoluteUrl(image.url) } : {}),
      source: a.source,
      sourceUrl: a.sourceUrl,
      dedupeKey: a.dedupeKey,
    };

    const res = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(60_000),
    });

    const data = (await res.json().catch(() => ({}))) as IngestResponse;
    if (!res.ok) {
      throw new Error(`website ingest ${res.status}: ${data.error ?? "unknown error"}`);
    }

    const id = data.post?.id ?? "unknown";
    // Build the public link from WEBSITE_PUBLIC_URL so it's clickable for readers
    // even when ingest runs on a private/localhost host. On a duplicate the API
    // omits `url`, so derive it from the existing post's id + language.
    const relative =
      data.url ??
      (data.post?.id && data.post?.language
        ? `/${data.post.language}/article/${data.post.id}`
        : undefined);
    const url = relative ? absoluteWebsite(env.WEBSITE_PUBLIC_URL, relative) : undefined;
    log.info({ id, duplicate: data.duplicate, category: payload.category }, "published to website");
    return { externalPostId: id, ...(url ? { url } : {}) };
  }
}

/** Resolve a site-relative article URL ("/ru/article/x") to an absolute one. */
function absoluteWebsite(base: string, path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${base.replace(/\/+$/, "")}${path.startsWith("/") ? "" : "/"}${path}`;
}
