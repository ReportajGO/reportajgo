import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAdSlot } from "@/lib/adSlots";
import { UploadError, deleteImage } from "@/lib/upload";
import { parseAdInput } from "@/lib/adPayload";

type Ctx = { params: Promise<{ id: string }> };

// PUT /api/ads/:id — update (partial). Also used by the one-click publish toggle.
export async function PUT(req: Request, { params }: Ctx) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const existing = await prisma.ad.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let input;
  try {
    input = await parseAdInput(req);
  } catch (e) {
    if (e instanceof UploadError)
      return NextResponse.json({ error: e.message }, { status: 400 });
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const { title, slot, imageUrl, linkUrl, published, order, startsAt, endsAt } = input;

  if (slot !== undefined && !isAdSlot(slot))
    return NextResponse.json({ error: "Invalid ad slot" }, { status: 400 });
  // The creative can be replaced, but never cleared to empty (imageUrl is required).
  if (imageUrl === null)
    return NextResponse.json({ error: "An ad image is required" }, { status: 400 });

  const imageChanges = imageUrl !== undefined && imageUrl !== existing.imageUrl;

  const ad = await prisma.ad.update({
    where: { id },
    data: {
      ...(title !== undefined ? { title: title.trim() } : {}),
      ...(slot !== undefined ? { slot } : {}),
      ...(imageUrl !== undefined ? { imageUrl } : {}),
      ...(linkUrl !== undefined ? { linkUrl: linkUrl || null } : {}),
      ...(published !== undefined ? { published: Boolean(published) } : {}),
      ...(order !== undefined ? { order } : {}),
      ...(startsAt !== undefined ? { startsAt } : {}),
      ...(endsAt !== undefined ? { endsAt } : {}),
    },
  });

  if (imageChanges) await deleteImage(existing.imageUrl);

  return NextResponse.json(ad);
}

// DELETE /api/ads/:id
export async function DELETE(_req: Request, { params }: Ctx) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const existing = await prisma.ad.findUnique({ where: { id } });
  await prisma.ad.delete({ where: { id } });
  if (existing) await deleteImage(existing.imageUrl);
  return NextResponse.json({ ok: true });
}
