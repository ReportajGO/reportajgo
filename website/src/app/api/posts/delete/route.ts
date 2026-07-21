import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { deleteImage } from "@/lib/upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/posts/delete — permanently delete several posts at once (admin
 * "selective delete"). Body: { ids: string[] }.
 *
 * Mirrors the single-post DELETE (/api/posts/:id): it removes the rows and then
 * best-effort cleans up each post's cover + gallery images. This is a HARD
 * delete — use the reversible "Clear all" (/api/posts/clear) for soft-hiding.
 */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { ids?: unknown } | null;
  const ids = Array.isArray(body?.ids)
    ? body!.ids.filter((v): v is string => typeof v === "string")
    : [];
  if (ids.length === 0)
    return NextResponse.json({ error: "No ids provided" }, { status: 400 });

  // Load first (for image cleanup), then delete the rows in one statement.
  const posts = await prisma.post.findMany({ where: { id: { in: ids } } });
  const result = await prisma.post.deleteMany({ where: { id: { in: ids } } });

  for (const p of posts) {
    await deleteImage(p.imageUrl);
    try {
      const urls: string[] = p.gallery ? JSON.parse(p.gallery) : [];
      for (const url of urls) await deleteImage(url);
    } catch {
      /* malformed gallery JSON — nothing to clean */
    }
  }

  return NextResponse.json({ ok: true, deleted: result.count });
}
