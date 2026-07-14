// The fixed set of on-page advertising placements. Each visible ad box on the
// public site is one named slot here; the admin assigns an ad to a slot, and the
// <AdSlot slot="…" /> component renders that slot's active creative.
//
// `format` only controls the box proportions (shared with the old placeholder
// sizes). `labelKey` maps into the "admin.ads.slots" i18n namespace.

export type AdFormat = "leaderboard" | "banner" | "rectangle";

export type AdSlotDef = {
  id: string;
  format: AdFormat;
  labelKey: string;
};

export const AD_SLOTS: readonly AdSlotDef[] = [
  { id: "top-leaderboard", format: "leaderboard", labelKey: "topLeaderboard" },
  { id: "home-rectangle", format: "rectangle", labelKey: "homeRectangle" },
  { id: "home-banner", format: "banner", labelKey: "homeBanner" },
  { id: "category-rectangle", format: "rectangle", labelKey: "categoryRectangle" },
  { id: "article-banner", format: "banner", labelKey: "articleBanner" },
] as const;

export type AdSlotId = (typeof AD_SLOTS)[number]["id"];

const SLOT_BY_ID: Record<string, AdSlotDef> = Object.fromEntries(
  AD_SLOTS.map((s) => [s.id, s]),
);

/** Whether a value is one of the known slot ids. */
export function isAdSlot(value: unknown): value is AdSlotId {
  return typeof value === "string" && value in SLOT_BY_ID;
}

export function adSlotDef(id: string): AdSlotDef | undefined {
  return SLOT_BY_ID[id];
}

/** Tailwind height classes per format (mirrors the former placeholder sizes). */
export const AD_FORMAT_SIZE: Record<AdFormat, string> = {
  leaderboard: "h-[100px] sm:h-[90px]",
  banner: "h-[110px] sm:h-[130px]",
  rectangle: "h-[250px]",
};
