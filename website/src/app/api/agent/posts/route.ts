import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkApiKey } from "@/lib/agentAuth";
import { isCategory } from "@/lib/constants";
import { locales } from "@/i18n/routing";
import { translateAll } from "@/lib/translate";
import { saveImageFromUrl } from "@/lib/upload";

// Prisma + remote translation need the Node.js runtime, not the edge runtime.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function unauthorized(c: { status: number; error: string }) {
  return NextResponse.json({ error: c.error }, { status: c.status });
}

/**
 * GET /api/agent/posts — let the agent pull posts it has published, e.g. to
 * confirm a cross-post or sync since a given time.
 * Query: ?language=ru&category=world&since=<ISO>&limit=50
 */
export async function GET(req: Request) {
  const auth = checkApiKey(req);
  if (!auth.ok) return unauthorized(auth);

  const url = new URL(req.url);
  const language = url.searchParams.get("language") ?? undefined;
  const category = url.searchParams.get("category") ?? undefined;
  const since = url.searchParams.get("since") ?? undefined;
  const limit = Math.min(Number(url.searchParams.get("limit")) || 50, 200);
  const sinceDate = since ? new Date(since) : undefined;

  const rows = await prisma.post.findMany({
    where: {
      origin: "agent",
      ...(language ? { language } : {}),
      ...(category ? { category: { slug: category } } : {}),
      ...(sinceDate && !isNaN(sinceDate.getTime())
        ? { createdAt: { gte: sinceDate } }
        : {}),
    },
    include: { category: true },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return NextResponse.json({
    count: rows.length,
    posts: rows.map((p) => ({
      id: p.id,
      title: p.title,
      excerpt: p.excerpt,
      language: p.language,
      category: p.category.slug,
      imageUrl: p.imageUrl,
      source: p.source,
      sourceUrl: p.sourceUrl,
      breaking: p.breaking,
      createdAt: p.createdAt,
      url: `/${p.language}/article/${p.id}`,
    })),
  });
}

/**
 * POST /api/agent/posts — the ReportajGO agent submits a news item that a human
 * has ALREADY approved in the agent's Telegram bot. So it is published live
 * immediately (no second moderation step), translated into every site locale.
 *
 * Body: { title, excerpt, content, category, language,
 *         imageUrl?, source?, sourceUrl?, breaking?, dedupeKey? }
 *  - 201 { duplicate:false, post } — created & live.
 *  - 200 { duplicate:true, post }  — dedupeKey already ingested (idempotent).
 *  - 400 invalid body · 401|403|503 auth.
 */
export async function POST(req: Request) {
  const auth = checkApiKey(req);
  if (!auth.ok) return unauthorized(auth);

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  const {
    title,
    excerpt,
    content,
    category,
    language,
    imageUrl,
    source,
    sourceUrl,
    breaking,
    dedupeKey,
  } = body;

  if (!title || !excerpt || !content)
    return NextResponse.json(
      { error: "Missing required fields: title, excerpt, content" },
      { status: 400 },
    );
  // Strict: agent articles must always include a photo.
  if (!imageUrl || typeof imageUrl !== "string" || !imageUrl.trim())
    return NextResponse.json(
      { error: "Missing required field: imageUrl (every post must have a photo)" },
      { status: 400 },
    );
  if (!isCategory(category))
    return NextResponse.json({ error: "Invalid category" }, { status: 400 });
  if (!locales.includes(language))
    return NextResponse.json({ error: "Invalid language" }, { status: 400 });

  // Idempotency: a repeated dedupeKey returns the existing post unchanged.
  if (dedupeKey) {
    const existing = await prisma.post.findUnique({ where: { dedupeKey } });
    if (existing) {
      return NextResponse.json({ duplicate: true, post: existing }, { status: 200 });
    }
  }

  // Re-host the agent's image locally so it's served same-origin (the agent
  // serves media on another host/port over http, which the site CSP blocks).
  // Falls back to the original URL if the download fails.
  let localImageUrl = imageUrl as string;
  try {
    localImageUrl = await saveImageFromUrl(imageUrl);
  } catch (err) {
    console.error("[agent] image re-host failed; using remote URL:", err);
  }

  // Translate into all site languages so the post shows on every locale.
  const translations = await translateAll(
    { title, excerpt, body: content },
    language,
  );

  const post = await prisma.post.create({
    data: {
      title,
      excerpt,
      body: content,
      translations: JSON.stringify(translations),
      imageUrl: localImageUrl || null,
      language,
      breaking: Boolean(breaking),
      published: true, // already approved upstream → live now
      origin: "agent",
      source: source || null,
      sourceUrl: sourceUrl || null,
      dedupeKey: dedupeKey || null,
      category: {
        connectOrCreate: { where: { slug: category }, create: { slug: category } },
      },
    },
    include: { category: true },
  });

  return NextResponse.json(
    { duplicate: false, post, url: `/${post.language}/article/${post.id}` },
    { status: 201 },
  );
}
