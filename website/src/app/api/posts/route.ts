import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isCategory, isAspect } from "@/lib/constants";
import { locales } from "@/i18n/routing";
import { UploadError } from "@/lib/upload";
import { parsePostInput, type PostInput } from "@/lib/postPayload";
import { translateAll } from "@/lib/translate";

// GET /api/posts — list all posts (admin).
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const posts = await prisma.post.findMany({
    include: { category: true, author: true },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(posts);
}

// POST /api/posts — create a post.
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let input: PostInput;
  try {
    input = await parsePostInput(req);
  } catch (e) {
    if (e instanceof UploadError)
      return NextResponse.json({ error: e.message }, { status: 400 });
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const { title, excerpt, content, category, language, imageUrl, breaking, published, aspect, gallery } =
    input;

  if (!title || !excerpt || !content)
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  if (!category || !isCategory(category))
    return NextResponse.json({ error: "Invalid category" }, { status: 400 });
  if (!language || !(locales as readonly string[]).includes(language))
    return NextResponse.json({ error: "Invalid language" }, { status: 400 });

  const author = await prisma.user.findUnique({
    where: { email: session.user.email },
  });

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
      aspect: aspect && isAspect(aspect) ? aspect : "16:9",
      gallery: gallery && gallery.length ? JSON.stringify(gallery) : null,
      language,
      breaking: Boolean(breaking),
      published: published === undefined ? true : Boolean(published),
      category: {
        connectOrCreate: {
          where: { slug: category },
          create: { slug: category },
        },
      },
      ...(author ? { author: { connect: { id: author.id } } } : {}),
    },
    include: { category: true },
  });

  return NextResponse.json(post, { status: 201 });
}
