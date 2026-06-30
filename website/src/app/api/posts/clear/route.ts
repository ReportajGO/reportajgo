import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/posts/clear — soft-delete ALL live posts (admin "Clear").
 *
 * Strict & reversible: requires an explicit `{ confirm: "CLEAR" }` body, only
 * sets `clearedAt` (nothing is hard-deleted), and is undone by /api/posts/restore.
 */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { confirm?: string } | null;
  if (body?.confirm !== "CLEAR")
    return NextResponse.json(
      { error: 'Confirmation required: send { "confirm": "CLEAR" }' },
      { status: 400 },
    );

  const r = await prisma.post.updateMany({
    where: { clearedAt: null },
    data: { clearedAt: new Date() },
  });
  return NextResponse.json({ ok: true, cleared: r.count });
}
