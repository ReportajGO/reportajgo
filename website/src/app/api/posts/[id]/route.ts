import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isCategory, isAspect } from "@/lib/constants";
import { locales } from "@/i18n/routing";
import { UploadError, deleteImage } from "@/lib/upload";
import { parsePostInput } from "@/lib/postPayload";
import { translateAll } from "@/lib/translate";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/posts/:id
export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const post = await prisma.post.findUnique({
    where: { id },
    include: { category: true, author: true },
  });
  if (!post) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Unpublished or soft-deleted ("cleared") posts are drafts — only expose them
  // to an authenticated admin, and never leak the author record to the public.
  const isPublic = post.published && !post.clearedAt;
  if (!isPublic) {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(post);
  }
  const { author: _author, ...publicPost } = post;
  return NextResponse.json(publicPost);
}

// PUT /api/posts/:id — update.
export async function PUT(req: Request, { params }: Ctx) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const existing = await prisma.post.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let input;
  try {
    input = await parsePostInput(req);
  } catch (e) {
    if (e instanceof UploadError)
      return NextResponse.json({ error: e.message }, { status: 400 });
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const { title, excerpt, content, category, language, imageUrl, breaking, published, aspect, gallery } =
    input;

  if (category && !isCategory(category))
    return NextResponse.json({ error: "Invalid category" }, { status: 400 });
  if (language && !(locales as readonly string[]).includes(language))
    return NextResponse.json({ error: "Invalid language" }, { status: 400 });

  // imageUrl === undefined → keep existing; otherwise it's a new upload URL or
  // an explicit null (clear). When the image changes, remove the old file.
  const imageChanges = imageUrl !== undefined && imageUrl !== existing.imageUrl;

  // Gallery: when provided, delete any previously-stored files no longer kept.
  let removedGallery: string[] = [];
  if (gallery !== undefined) {
    let prev: string[] = [];
    try {
      prev = existing.gallery ? JSON.parse(existing.gallery) : [];
    } catch {
      prev = [];
    }
    removedGallery = prev.filter((u) => !gallery.includes(u));
  }

  // Re-translate when any text or the source language changed, so every locale
  // stays in sync with the edit.
  const textChanged =
    title !== undefined ||
    excerpt !== undefined ||
    content !== undefined ||
    language !== undefined;
  let translations: string | undefined;
  if (textChanged) {
    const tr = await translateAll(
      {
        title: title ?? existing.title,
        excerpt: excerpt ?? existing.excerpt,
        body: content ?? existing.body,
      },
      language ?? existing.language,
    );
    translations = JSON.stringify(tr);
  }

  const post = await prisma.post.update({
    where: { id },
    data: {
      ...(title !== undefined ? { title } : {}),
      ...(excerpt !== undefined ? { excerpt } : {}),
      ...(content !== undefined ? { body: content } : {}),
      ...(translations !== undefined ? { translations } : {}),
      ...(imageUrl !== undefined ? { imageUrl: imageUrl || null } : {}),
      ...(aspect && isAspect(aspect) ? { aspect } : {}),
      ...(gallery !== undefined
        ? { gallery: gallery.length ? JSON.stringify(gallery) : null }
        : {}),
      ...(language !== undefined ? { language } : {}),
      ...(breaking !== undefined ? { breaking: Boolean(breaking) } : {}),
      ...(published !== undefined
        ? { published: Boolean(published) }
        : {}),
      ...(category
        ? {
            category: {
              connectOrCreate: {
                where: { slug: category },
                create: { slug: category },
              },
            },
          }
        : {}),
    },
  });

  if (imageChanges) await deleteImage(existing.imageUrl);
  for (const url of removedGallery) await deleteImage(url);

  return NextResponse.json(post);
}

// DELETE /api/posts/:id
export async function DELETE(_req: Request, { params }: Ctx) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const existing = await prisma.post.findUnique({ where: { id } });
  await prisma.post.delete({ where: { id } });
  if (existing) {
    await deleteImage(existing.imageUrl);
    try {
      const urls: string[] = existing.gallery ? JSON.parse(existing.gallery) : [];
      for (const url of urls) await deleteImage(url);
    } catch {
      /* malformed gallery JSON — nothing to clean */
    }
  }
  return NextResponse.json({ ok: true });
}
