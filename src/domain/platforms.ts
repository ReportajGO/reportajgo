import type { AspectRatio, MediaType, Platform } from "./types.js";

/**
 * Per-platform content profile. Drives BOTH the copy style (prompt guidance,
 * length limits, hashtag policy) and the media spec (type + aspect ratio).
 * This is the single source of truth for "different styles per social media".
 */
export interface PlatformProfile {
  platform: Platform;
  /** Short id used as the `style` field on a draft. */
  styleId: string;
  /** Human-facing description fed into the copy-generation prompt. */
  styleGuidance: string;
  /** Hard character cap for the post body (undefined = no hard cap). */
  maxChars?: number;
  /** Recommended hashtag count. 0 = no hashtags. */
  hashtagCount: number;
  /** Preferred media for this platform. */
  media: { type: MediaType; aspectRatio: AspectRatio };
  /** Whether this platform requires media (can't post text-only). */
  mediaRequired: boolean;
}

export const PLATFORM_PROFILES: Record<Platform, PlatformProfile> = {
  TELEGRAM: {
    platform: "TELEGRAM",
    styleId: "telegram-narrative",
    styleGuidance:
      "News-channel post for a regional Telegram audience. Do NOT repeat the " +
      "headline (it's shown above the post). Open with one strong sentence of " +
      "context, then a single emoji-led section header (e.g. '⚙️ Asosiy " +
      "tafsilotlar:') followed by 2-4 short lines, each starting with a brief " +
      "label and an em-dash (e.g. 'Ishtirokchilar — ...'). Close with one " +
      "forward-looking sentence. Tasteful emoji only. Do not add links, a " +
      "footer, or a sign-off — those are added automatically.",
    // Cap below Telegram's 1024 so the flag+headline, hashtags, social footer and
    // the website link always fit alongside the body.
    maxChars: 680,
    hashtagCount: 3,
    media: { type: "IMAGE", aspectRatio: "16:9" },
    mediaRequired: false,
  },
  INSTAGRAM: {
    platform: "INSTAGRAM",
    styleId: "instagram-punchy",
    styleGuidance:
      "Punchy, visual-first caption. One bold hook line, then 2-3 tight sentences. " +
      "Friendly, scroll-stopping tone. Hashtags grouped at the end.",
    maxChars: 2200,
    hashtagCount: 8,
    // Image feed post for now. The web publisher + approval flow already handle a
    // VIDEO (Reel) when a draft carries one — switch this to VIDEO/9:16 once the
    // reel-generation engine is wired (REST DoP + public media URL).
    media: { type: "IMAGE", aspectRatio: "4:5" },
    mediaRequired: true,
  },
  WEBSITE: {
    platform: "WEBSITE",
    styleId: "website-article",
    styleGuidance:
      "Article-style news write-up for the website. Open with a strong headline-style " +
      "first line, then 3-5 informative paragraphs giving context, key facts, and source " +
      "attribution. Neutral, journalistic, well-structured. No emoji.",
    hashtagCount: 0,
    media: { type: "IMAGE", aspectRatio: "16:9" },
    mediaRequired: false,
  },
  YOUTUBE: {
    platform: "YOUTUBE",
    styleId: "youtube-shorts",
    styleGuidance:
      "YouTube Shorts: a searchable title-style first line, then a 1-2 sentence " +
      "description with keywords. Hashtags at the end.",
    maxChars: 1000,
    hashtagCount: 4,
    media: { type: "VIDEO", aspectRatio: "9:16" },
    mediaRequired: true,
  },
};

export function profileFor(platform: Platform): PlatformProfile {
  return PLATFORM_PROFILES[platform];
}

export function platformsWithoutRequiredMedia(): Platform[] {
  return Object.values(PLATFORM_PROFILES)
    .filter((profile) => !profile.mediaRequired)
    .map((profile) => profile.platform);
}
