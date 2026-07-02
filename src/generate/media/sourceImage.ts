import { logger } from "../../config/logger.js";
import { safeFetch } from "../../util/ssrf.js";

const log = logger.child({ module: "source-image" });

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const FETCH_TIMEOUT_MS = 15_000;

export interface FetchedImage {
  bytes: Buffer;
  mime: string;
}

/**
 * Find the article's main photo: fetch the page (following the grounding
 * redirect to the real outlet) and read its og:image / twitter:image meta tag.
 * Returns an absolute image URL, or null if none is usable.
 */
export async function findArticleImageUrl(pageUrl: string): Promise<string | null> {
  try {
    // SSRF-safe: validates the page URL and every redirect hop is public.
    const res = await safeFetch(
      pageUrl,
      { headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml" } },
      FETCH_TIMEOUT_MS,
    );
    if (!res.ok) return null;
    if (!(res.headers.get("content-type") ?? "").includes("html")) return null;
    const html = await res.text();
    return extractOgImage(html, res.url || pageUrl);
  } catch (err) {
    log.warn({ err: msg(err), pageUrl }, "source image lookup failed");
    return null;
  }
}

/** Download an image URL into bytes, validating it's a real raster image. */
export async function downloadImage(url: string): Promise<FetchedImage | null> {
  try {
    // SSRF-safe: the og:image URL comes from a third-party page, so validate it.
    const res = await safeFetch(
      url,
      { headers: { "user-agent": UA, accept: "image/*" } },
      FETCH_TIMEOUT_MS,
    );
    if (!res.ok) return null;
    const mime = (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    if (!mime.startsWith("image/") || mime.includes("svg")) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    // Guard against tracking pixels / tiny icons.
    if (bytes.length < 8_000) return null;
    return { bytes, mime };
  } catch (err) {
    log.warn({ err: msg(err), url }, "image download failed");
    return null;
  }
}

const OG_PATTERNS: RegExp[] = [
  /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i,
  /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["']/i,
  /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["']/i,
  /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image(?::src)?["']/i,
];

function extractOgImage(html: string, baseUrl: string): string | null {
  for (const re of OG_PATTERNS) {
    const m = html.match(re);
    const raw = m?.[1]?.trim();
    if (!raw) continue;
    const abs = absolutize(raw, baseUrl);
    if (abs && isLikelyPhoto(abs)) return abs;
  }
  return null;
}

function absolutize(url: string, base: string): string | null {
  try {
    return new URL(url, base).toString();
  } catch {
    return null;
  }
}

/** Skip obvious non-photos: svg, gifs, sprites, icons, logos, placeholders. */
function isLikelyPhoto(url: string): boolean {
  const u = url.toLowerCase();
  if (/\.(svg|gif|ico)(\?|$)/.test(u)) return false;
  if (/(sprite|icon|logo|placeholder|default|avatar|favicon|blank)/.test(u)) return false;
  return true;
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
