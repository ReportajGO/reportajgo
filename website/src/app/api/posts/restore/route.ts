import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/posts/restore — bring back ALL cleared posts (the reverse of Clear).
 * Non-destructive; restores every soft-deleted post to live.
 */
export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const r = await prisma.post.updateMany({
    where: { clearedAt: { not: null } },
    data: { clearedAt: null },
  });
  return NextResponse.json({ ok: true, restored: r.count });
}
