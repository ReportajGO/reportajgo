import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/posts/trash — move several posts to the trash (admin "selective
 * delete"). Body: { ids: string[] }.
 *
 * This is a SOFT delete: it sets `clearedAt`, hiding the posts everywhere public
 * but keeping them recoverable via /api/posts/restore. Permanent removal is
 * /api/posts/delete.
 */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { ids?: unknown } | null;
  const ids = Array.isArray(body?.ids)
    ? body!.ids.filter((v): v is string => typeof v === "string")
    : [];
  if (ids.length === 0)
    return NextResponse.json({ error: "No ids provided" }, { status: 400 });

  const r = await prisma.post.updateMany({
    where: { id: { in: ids }, clearedAt: null },
    data: { clearedAt: new Date() },
  });
  return NextResponse.json({ ok: true, trashed: r.count });
}
