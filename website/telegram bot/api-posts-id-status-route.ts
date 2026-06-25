// Original location: src/app/api/posts/[id]/status/route.ts
// Admin-panel moderation endpoint (approve/reject without Telegram). Pairs with
// the bot but is independent — wire it up if you also want in-dashboard buttons.
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { POST_STATUS, type PostStatusValue } from "@/lib/constants";
import { notifyAgentDecision } from "@/lib/agentCallback";

type Ctx = { params: Promise<{ id: string }> };

const VALID = Object.values(POST_STATUS);

/**
 * POST /api/posts/:id/status — moderate a post directly from the admin panel.
 * Body: { status: "PENDING" | "PUBLISHED" | "REJECTED" }.
 * Keeps the legacy `published` flag in sync with the moderation status.
 */
export async function POST(req: Request, { params }: Ctx) {
  const session = await getServerSession(authOptions);
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const status = body?.status as PostStatusValue | undefined;

  if (!status || !VALID.includes(status))
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });

  const isPublish = status === POST_STATUS.PUBLISHED;
  const post = await prisma.post.update({
    where: { id },
    data: {
      status,
      published: isPublish,
      ...(isPublish ? { approvedAt: new Date() } : {}),
    },
    include: { category: true },
  });

  // Tell the AI agent about the decision (best-effort, no-op if unconfigured).
  if (status === POST_STATUS.PUBLISHED || status === POST_STATUS.REJECTED) {
    await notifyAgentDecision({ ...post, category: post.category.slug });
  }

  return NextResponse.json(post);
}
