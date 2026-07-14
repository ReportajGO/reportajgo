import { prisma } from "./prisma";
import type { Ad } from "@prisma/client";

/**
 * The one ad to show in a slot right now: published, inside its optional flight
 * window, highest priority (lowest `order`, newest as tiebreak). Returns null
 * when nothing qualifies — the slot then renders nothing.
 */
export async function getAdForSlot(slotId: string): Promise<Ad | null> {
  const now = new Date();
  return prisma.ad.findFirst({
    where: {
      slot: slotId,
      published: true,
      AND: [
        { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
        { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
      ],
    },
    orderBy: [{ order: "asc" }, { createdAt: "desc" }],
  });
}

/** All ads for the admin list (newest first, grouped by slot then priority). */
export async function getAllAdsAdmin(): Promise<Ad[]> {
  return prisma.ad.findMany({
    orderBy: [{ slot: "asc" }, { order: "asc" }, { createdAt: "desc" }],
  });
}

export async function getAdById(id: string): Promise<Ad | null> {
  return prisma.ad.findUnique({ where: { id } });
}
