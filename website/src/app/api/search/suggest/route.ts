import { NextResponse } from "next/server";
import { locales } from "@/i18n/routing";
import { suggest } from "@/lib/search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/search/suggest?q=...&locale=ru — live search recommendations.
 * Public (read-only): returns matching articles, sections, query completions,
 * a "did you mean" on misses, and trending posts when the query is empty.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").slice(0, 80);
  const localeParam = url.searchParams.get("locale") ?? "ru";
  const locale = (locales as readonly string[]).includes(localeParam)
    ? localeParam
    : "ru";

  try {
    const data = await suggest(locale, q);
    return NextResponse.json(data, {
      headers: { "cache-control": "no-store" },
    });
  } catch (err) {
    console.error("[search] suggest failed:", err);
    return NextResponse.json(
      { query: q, terms: [], themes: [], articles: [], trending: [], didYouMean: null },
      { status: 200 },
    );
  }
}
