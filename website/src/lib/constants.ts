// Shared, framework-agnostic constants.

export const CATEGORIES = [
  "world",
  "economics",
  "sport",
  "culture",
  "tech",
] as const;

export type CategorySlug = (typeof CATEGORIES)[number];

// Nav order shown in the header (home is a virtual entry).
export const NAV_ORDER = ["home", ...CATEGORIES] as const;

// Brand color per section — used for generated cover tiles.
export const CAT_COLOR: Record<CategorySlug, string> = {
  world: "#1f44ff",
  economics: "#0c8f6e",
  sport: "#E51A24",
  culture: "#8b3df0",
  tech: "#0f7bbd",
};

// Big watermark word baked into cover tiles.
export const CAT_WORD: Record<CategorySlug, string> = {
  world: "WORLD",
  economics: "ECON",
  sport: "SPORT",
  culture: "KULT",
  tech: "TECH",
};

export function isCategory(value: string): value is CategorySlug {
  return (CATEGORIES as readonly string[]).includes(value);
}

// Cover aspect ratios the admin can choose, with their CSS aspect-ratio value.
export const ASPECTS = ["16:9", "1:1", "4:5"] as const;
export type AspectRatio = (typeof ASPECTS)[number];
export const ASPECT_CSS: Record<AspectRatio, string> = {
  "16:9": "16 / 9",
  "1:1": "1 / 1",
  "4:5": "4 / 5",
};
export function isAspect(value: string): value is AspectRatio {
  return (ASPECTS as readonly string[]).includes(value);
}
