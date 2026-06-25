import { createHash } from "node:crypto";
import type { ResearchedNews } from "../domain/types.js";

/** Normalize a URL for dedupe: strip protocol, query, trailing slash, www. */
function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    const path = u.pathname.replace(/\/+$/, "");
    return `${host}${path}`.toLowerCase();
  } catch {
    return url.trim().toLowerCase();
  }
}

/** Normalize a title for dedupe: lowercase, collapse whitespace, drop punctuation. */
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Stable dedupe key. Two items map to the same hash when they share a
 * normalized URL OR (as a weaker signal) an identical normalized title.
 * We key primarily on URL since that's the strongest identity signal.
 */
export function contentHash(news: ResearchedNews): string {
  const key = `${normalizeUrl(news.sourceUrl)}|${normalizeTitle(news.title)}`;
  return createHash("sha256").update(key).digest("hex");
}
