// UTM tracking for cross-platform attribution.
//
// Source of truth: TZ §7.2 (kontent pasporti — "kuzatiladigan UTM havola"),
// §15 (KPI: "UTM bilan 100% kuzatuv"), §16 (analitika tizimi), §22 (acceptance:
// a tracking chain between site, social, UTM and CRM).
//
// The strategy requires 100% of social links to be attributable: every post that
// points at reportajgo.uz must carry parameters identifying the market, platform,
// vertical and format that produced the click. Without this the KPI "sayt trafik
// — UTM bilan 100% kuzatuv" cannot be met, and the business-result KPI (investor
// and partner enquiries per market) has no source data.

import { env } from "../config/env.js";
import type { ContentFormat, MarketCode, Platform, Vertical } from "../domain/types.js";

export interface UtmParams {
  /** The destination article URL. When absent, no tracking link is produced. */
  url: string | null;
  market: MarketCode | string | null;
  platform: Platform;
  vertical: Vertical | string | null;
  format: ContentFormat | string | null;
  /** Optional campaign override; defaults to a market+vertical campaign name. */
  campaign?: string;
}

/** Lowercased, hyphen-safe token for a UTM value. */
function token(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Build the UTM-tagged tracking URL for a draft.
 *
 * Returns null when there is no destination yet — a draft is created before its
 * website article is published, so `websiteUrl` is often not known at drafting
 * time. Callers should re-derive the link at publish time once the article URL
 * exists; the passport records whatever was known when the draft was written.
 *
 * Existing query parameters on the destination are preserved, and existing utm_*
 * parameters are overwritten rather than duplicated.
 */
export function buildUtmUrl(params: UtmParams): string | null {
  const base = params.url?.trim();
  if (!base) return null;

  let target: URL;
  try {
    target = new URL(base, env.WEBSITE_PUBLIC_URL);
  } catch {
    return null;
  }

  const market = params.market ? token(String(params.market)) : "global";
  const vertical = params.vertical ? token(String(params.vertical)) : "general";
  const format = params.format ? token(String(params.format)) : "post";

  // source = the platform the click came from; medium = "social" for every
  // social surface, so site analytics can group all of them against direct and
  // search traffic. content = market/vertical/format, the editorial dimensions.
  target.searchParams.set("utm_source", token(params.platform));
  target.searchParams.set("utm_medium", "social");
  target.searchParams.set("utm_campaign", params.campaign ? token(params.campaign) : `${market}-${vertical}`);
  target.searchParams.set("utm_content", `${format}-${market}`);

  return target.toString();
}

/**
 * Re-derive the tracking link at publish time, once the article URL is known.
 * Used by the publishers so the link in the live post is always attributable
 * even when the draft was written before the website article existed.
 */
export function trackingUrlForPublish(
  articleUrl: string | null | undefined,
  draft: {
    market?: string | null;
    platform: Platform;
    format?: string | null;
  },
  vertical?: string | null,
): string | null {
  return buildUtmUrl({
    url: articleUrl ?? null,
    market: draft.market ?? null,
    platform: draft.platform,
    vertical: vertical ?? null,
    format: draft.format ?? null,
  });
}
