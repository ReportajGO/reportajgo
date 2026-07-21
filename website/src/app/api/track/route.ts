import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VISITOR_COOKIE = "rgo_vid";
// Skip obvious crawlers so the audience numbers reflect real people.
const BOT_UA = /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|preview|monitor|headless/i;

/**
 * POST /api/track — record one public page view for audience analytics.
 *
 * Fire-and-forget from the client (see VisitTracker). The visitor id comes from
 * the httpOnly `rgo_vid` cookie set in middleware, so page views (rows) and
 * unique visitors (distinct visitorId) can both be counted per time window.
 */
export async function POST(req: Request) {
  const ua = req.headers.get("user-agent") ?? "";
  if (BOT_UA.test(ua)) return NextResponse.json({ ok: true, skipped: "bot" });

  const cookie = req.headers.get("cookie") ?? "";
  const visitorId = new RegExp(`(?:^|;\\s*)${VISITOR_COOKIE}=([^;]+)`).exec(cookie)?.[1];
  if (!visitorId) return NextResponse.json({ ok: true, skipped: "no-cookie" });

  const body = (await req.json().catch(() => null)) as { path?: unknown } | null;
  const path = typeof body?.path === "string" ? body.path.slice(0, 300) : null;

  // Best-effort: analytics must never break a page view.
  try {
    await prisma.visit.create({ data: { visitorId: decodeURIComponent(visitorId), path } });
  } catch {
    return NextResponse.json({ ok: false });
  }
  return NextResponse.json({ ok: true });
}
