import type { MediaType, Platform } from "../domain/types.js";

export interface PublishMedia {
  type: MediaType;
  url: string;
}

export interface PublishInput {
  platform: Platform;
  body: string;
  hashtags: string[];
  media: PublishMedia[];
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
