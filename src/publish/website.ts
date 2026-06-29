import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import type { Platform } from "../domain/types.js";
import type { Publisher, PublishInput, PublishResult } from "./publisher.js";

const log = logger.child({ module: "publish:website" });

// Site categories accepted by POST /api/agent/posts.
type SiteCategory = "world" | "economics" | "sport" | "culture" | "tech";

// Keyword → category. First match wins; falls back to "world".
const CATEGORY_RULES: { category: SiteCategory; pattern: RegExp }[] = [
  { category: "tech", pattern: /\b(tech|technolog|ai|software|gadget|startup|science|space|cyber)\b/i },
  { category: "economics", pattern: /\b(econom|business|market|finance|financial|trade|money|bank|stock|inflation|currency|crypto)\b/i },
  { category: "sport", pattern: /\b(sport|football|soccer|olympic|match|tournament|league|cricket|tennis|nba|fifa)\b/i },
  { category: "culture", pattern: /\b(culture|art|music|film|movie|entertain|celebrit|fashion|festival|book|heritage)\b/i },
];

function mapCategory(...hints: (string | undefined)[]): SiteCategory {
  const hay = hints.filter(Boolean).join(" ");
  for (const rule of CATEGORY_RULES) {
    if (rule.pattern.test(hay)) return rule.category;
  }
  return "world";
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

    // Strict: every website article MUST carry its generated photo. If the
    // image isn't ready, refuse to publish (the post stays unpublished and can
    // be retried once media is ready) rather than posting a text-only article.
    const image = input.media.find((m) => m.type === "IMAGE" && m.url);
    if (!image) {
      throw new Error("WEBSITE publish requires a ready image; none found — not posting text-only");
    }
    const payload = {
      title: a.title,
      excerpt: a.excerpt,
      content: input.body,
      category: mapCategory(a.topic, a.title, a.excerpt),
      language: mapLanguage(a.language),
      imageUrl: absoluteUrl(image.url),
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
