// Original location: src/app/api/agent/posts/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkApiKey } from "@/lib/agentAuth";
import { isCategory, POST_STATUS } from "@/lib/constants";
import { locales } from "@/i18n/routing";
import { notifyNewPost } from "@/lib/telegram-moderation";
import { translateAll } from "@/lib/translate";

export const dynamic = "force-dynamic";

function unauthorized(c: { status: number; error: string }) {
  return NextResponse.json({ error: c.error }, { status: c.status });
}

/**
 * GET /api/agent/posts — let the agent pull posts by status/language/since,
 * e.g. everything approved since its last sync, to cross-post elsewhere.
 *
 * Query: ?status=PUBLISHED&language=ru&category=world&since=<ISO>&limit=50
 */
export async function GET(req: Request) {
  const auth = checkApiKey(req);
  if (!auth.ok) return unauthorized(auth);

  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? undefined;
  const language = url.searchParams.get("language") ?? undefined;
  const category = url.searchParams.get("category") ?? undefined;
  const since = url.searchParams.get("since") ?? undefined;
  const limit = Math.min(Number(url.searchParams.get("limit")) || 50, 200);

  const sinceDate = since ? new Date(since) : undefined;
  const useApproved = status === POST_STATUS.PUBLISHED;

  const rows = await prisma.post.findMany({
    where: {
      ...(status ? { status } : {}),
      ...(language ? { language } : {}),
      ...(category ? { category: { slug: category } } : {}),
      ...(sinceDate && !isNaN(sinceDate.getTime())
        ? useApproved
          ? { approvedAt: { gte: sinceDate } }
          : { updatedAt: { gte: sinceDate } }
        : {}),
    },
    include: { category: true },
    orderBy: useApproved ? { approvedAt: "desc" } : { createdAt: "desc" },
    take: limit,
  });

  return NextResponse.json({
    count: rows.length,
    posts: rows.map((p) => ({
      id: p.id,
      title: p.title,
      excerpt: p.excerpt,
      body: p.body,
      language: p.language,
      category: p.category.slug,
      status: p.status,
      imageUrl: p.imageUrl,
      source: p.source,
      sourceUrl: p.sourceUrl,
      breaking: p.breaking,
      approvedAt: p.approvedAt,
      publishAt: p.publishAt,
      createdAt: p.createdAt,
      url: `/${p.language}/article/${p.id}`,
    })),
  });
}

/**
 * POST /api/agent/posts — the AI agent submits a found/filtered news item.
 * It is stored as PENDING and a moderation card is sent to Telegram. After a
 * moderator approves (TG button or admin panel), it appears on the site and
 * the agent is notified (callback) / can fetch it via GET.
 *
 * Body: { title, excerpt, content, category, language, imageUrl?, source?,
 *         sourceUrl?, breaking?, dedupeKey?, publishAt? }
 *
 * `publishAt` (optional ISO 8601) is a suggested go-live time shown to the
 * moderator; they confirm or override it in Telegram. A past/invalid value is
 * ignored (treated as "publish on approval").
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
    publishAt,
  } = body;

  if (!title || !excerpt || !content)
    return NextResponse.json(
      { error: "Missing required fields: title, excerpt, content" },
      { status: 400 },
    );
  if (!isCategory(category))
    return NextResponse.json({ error: "Invalid category" }, { status: 400 });
  if (!locales.includes(language))
    return NextResponse.json({ error: "Invalid language" }, { status: 400 });

  // Optional suggested go-live time. Keep only a valid future instant; anything
  // else means "publish on approval" (null).
  let publishAtDate: Date | null = null;
  if (publishAt != null) {
    const d = new Date(publishAt);
    if (isNaN(d.getTime()))
      return NextResponse.json(
        { error: "Invalid publishAt (expected ISO 8601 datetime)" },
        { status: 400 },
      );
    if (d.getTime() > Date.now()) publishAtDate = d;
  }

  // Idempotency: if this dedupeKey was already ingested, return the existing one.
  if (dedupeKey) {
    const existing = await prisma.post.findUnique({ where: { dedupeKey } });
    if (existing) {
      return NextResponse.json(
        { duplicate: true, post: existing },
        { status: 200 },
      );
    }
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
      imageUrl: imageUrl || null,
      language,
      breaking: Boolean(breaking),
      status: POST_STATUS.PENDING,
      published: false,
      origin: "agent",
      source: source || null,
      sourceUrl: sourceUrl || null,
      dedupeKey: dedupeKey || null,
      publishAt: publishAtDate,
      category: {
        connectOrCreate: { where: { slug: category }, create: { slug: category } },
      },
    },
    include: { category: true },
  });

  // Send the moderation card. A Telegram failure must not fail ingestion.
  try {
    const { chatId, messageId } = await notifyNewPost(post);
    await prisma.post.update({
      where: { id: post.id },
      data: { tgChatId: chatId, tgMessageId: messageId },
    });
  } catch (err) {
    console.error("[agent] telegram notify failed:", err);
  }

  return NextResponse.json({ duplicate: false, post }, { status: 201 });
}
