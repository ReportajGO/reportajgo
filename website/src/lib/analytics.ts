import { prisma } from "./prisma";

export interface WindowStat {
  visitors: number; // unique first-party visitor ids in the window
  views: number; // total page views (Visit rows) in the window
}

export interface AudienceStats {
  day: WindowStat;
  week: WindowStat;
  month: WindowStat;
  year: WindowStat;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOWS: { key: keyof AudienceStats; days: number }[] = [
  { key: "day", days: 1 },
  { key: "week", days: 7 },
  { key: "month", days: 30 },
  { key: "year", days: 365 },
];

async function statSince(from: Date): Promise<WindowStat> {
  // One round-trip per window: unique visitors + total views together.
  const rows = await prisma.$queryRaw<{ visitors: bigint; views: bigint }[]>`
    SELECT COUNT(DISTINCT "visitorId") AS visitors, COUNT(*) AS views
    FROM "Visit"
    WHERE "createdAt" >= ${from}
  `;
  const r = rows[0];
  return { visitors: Number(r?.visitors ?? 0), views: Number(r?.views ?? 0) };
}

/**
 * Rolling audience stats for the admin dashboard: unique visitors and page
 * views over the last day / week / month / year.
 */
export async function getAudienceStats(now: Date = new Date()): Promise<AudienceStats> {
  const entries = await Promise.all(
    WINDOWS.map(async (w) => [w.key, await statSince(new Date(now.getTime() - w.days * DAY_MS))] as const),
  );
  return Object.fromEntries(entries) as unknown as AudienceStats;
}
