import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { themeSlug } from "../domain/themes.js";
import type { Platform } from "../domain/types.js";
import { isPubliclyFetchableUrl } from "../util/ssrf.js";
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

/**
 * The cover URL to hand the site — or nothing at all.
 *
 * The site re-hosts the cover by FETCHING this URL from its own container, and
 * if that fetch fails it keeps the URL and serves it to readers. So a URL only
 * this process can reach — which is what PUBLIC_BASE_URL degrades to when it is
 * left unset under MEDIA_STORAGE_DRIVER=local: http://localhost:3010/media/… —
 * becomes a broken cover on every article. Dropping it instead lets the site
 * render its branded gradient placeholder, and the log line says how to fix the
 * configuration rather than leaving a silently broken site.
 */
function publishableCoverUrl(url: string): string | undefined {
  const abs = absoluteUrl(url);
  if (isPubliclyFetchableUrl(abs)) return abs;
  log.error(
    { url: abs },
    "media URL is not reachable from outside this host — publishing the article without a cover. " +
      "Set PUBLIC_BASE_URL to the public origin that serves /media (e.g. https://<domain>/agent), " +
      "or switch MEDIA_STORAGE_DRIVER=s3.",
  );
  return undefined;
}

interface IngestResponse {
  duplicate?: boolean;
  post?: { id?: string; slug?: string | null; language?: string };
  url?: string;
  error?: string;
}

/**
 * Publishes an approved draft to the ReportageGO website via its agent ingest
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
    const coverUrl = image?.url ? publishableCoverUrl(image.url) : undefined;
    const payload = {
      title: a.title,
      excerpt: a.excerpt,
      content: input.body,
      category: articleTheme(a.topic),
      language: mapLanguage(a.language),
      ...(coverUrl ? { imageUrl: coverUrl } : {}),
      source: a.source,
      sourceUrl: a.sourceUrl,
      dedupeKey: a.dedupeKey,
      ...(a.breaking ? { breaking: true } : {}),
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
    // The API returns `url` (built from the pretty slug) on both create and
    // duplicate. Fall back to slug-then-id only if it's ever omitted.
    const relative =
      data.url ??
      (data.post?.language && (data.post?.slug || data.post?.id)
        ? `/${data.post.language}/article/${data.post.slug ?? data.post.id}`
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
