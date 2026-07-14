import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAdSlot } from "@/lib/adSlots";
import { UploadError } from "@/lib/upload";
import { parseAdInput, type AdInput } from "@/lib/adPayload";

// GET /api/ads — list all ads (admin only).
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ads = await prisma.ad.findMany({
    orderBy: [{ slot: "asc" }, { order: "asc" }, { createdAt: "desc" }],
  });
  return NextResponse.json(ads);
}

// POST /api/ads — create an ad.
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let input: AdInput;
  try {
    input = await parseAdInput(req);
  } catch (e) {
    if (e instanceof UploadError)
      return NextResponse.json({ error: e.message }, { status: 400 });
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const { title, slot, imageUrl, linkUrl, published, order, startsAt, endsAt } = input;

  if (!title || !title.trim())
    return NextResponse.json({ error: "A title is required" }, { status: 400 });
  if (!slot || !isAdSlot(slot))
    return NextResponse.json({ error: "Invalid ad slot" }, { status: 400 });
  if (!imageUrl)
    return NextResponse.json({ error: "An ad image is required" }, { status: 400 });

  const ad = await prisma.ad.create({
    data: {
      title: title.trim(),
      slot,
      imageUrl,
      linkUrl: linkUrl || null,
      published: published ?? false,
      order: order ?? 100,
      startsAt: startsAt ?? null,
      endsAt: endsAt ?? null,
    },
  });

  return NextResponse.json(ad, { status: 201 });
}
