import type { MediaType, Platform } from "../domain/types.js";

export interface PublishMedia {
  type: MediaType;
  url: string;
}

/**
 * Article metadata used by publishers that need more than a caption (the
 * WEBSITE publisher builds a full article from this). Social publishers
 * (Telegram/Meta) ignore it and just use body + media.
 */
export interface PublishArticle {
  /** Themed headline / article title. */
  title: string;
  /** Short summary / standfirst. */
  excerpt: string;
  /** Post language code ("uz" | "ru" | "en"). */
  language: string;
  /** Originating news topic (used to map a site category). */
  topic?: string;
  /** Publisher name of the original story. */
  source?: string;
  /** Original article URL. */
  sourceUrl?: string;
  /** Stable idempotency key (the news item's content hash). */
  dedupeKey?: string;
}

export interface PublishInput {
  platform: Platform;
  body: string;
  hashtags: string[];
  media: PublishMedia[];
  /** Present when the draft carries article metadata (WEBSITE, etc.). */
  article?: PublishArticle;
  /**
   * Public URL of the already-published website article for this story. Social
   * publishers (Telegram, etc.) append it so each post links back to the full
   * write-up on the site. Undefined when WEBSITE isn't enabled or hasn't
   * published yet.
   */
  articleUrl?: string;
}

export interface PublishResult {
  /** Platform-native id of the created post. */
  externalPostId: string;
  /** Public URL of the post, when derivable. */
  url?: string;
}

/** One implementation per social platform. */
export interface Publisher {
  readonly platform: Platform;
  publish(input: PublishInput): Promise<PublishResult>;
}

/** Compose the final caption: body followed by hashtags. */
export function buildCaption(input: PublishInput): string {
  const tags = input.hashtags.map((h) => `#${h.replace(/^#/, "")}`).join(" ");
  return tags ? `${input.body}\n\n${tags}` : input.body;
}
