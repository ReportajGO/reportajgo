// Shared domain types used across pipeline stages.
// These mirror (but are decoupled from) the Prisma models so business logic
// doesn't depend directly on the ORM shapes.

export type Platform =
  | "TELEGRAM"
  | "INSTAGRAM"
  | "FACEBOOK"
  | "YOUTUBE"
  | "WEBSITE";

export type AspectRatio = "1:1" | "9:16" | "16:9" | "4:5";

export type MediaType = "IMAGE" | "VIDEO";

/** A raw news candidate produced by the research stage (pre-persistence). */
export interface ResearchedNews {
  title: string;
  summary: string;
  sourceUrl: string;
  sourceName?: string;
  language: string;
  topic?: string;
  publishedAt?: Date;
}

/** Ranking verdict from the filter stage. */
export interface RankVerdict {
  score: number; // 0..1 overall priority
  relevance: number; // 0..1 topical relevance
  keep: boolean;
  reasons: string;
}

/** Generated copy for one platform. */
export interface GeneratedCopy {
  platform: Platform;
  language: string;
  style: string;
  body: string;
  hashtags: string[];
}

/** A media generation request handed to a MediaProvider. */
export interface MediaRequest {
  type: MediaType;
  prompt: string;
  aspectRatio: AspectRatio;
  // Optional source image (URL or base64) for image-to-video.
  sourceImageUrl?: string;
}

/** Result of a media generation request. */
export interface MediaResult {
  provider: string;
  type: MediaType;
  aspectRatio: AspectRatio;
  url?: string;
  externalJobId?: string;
  status: "QUEUED" | "GENERATING" | "READY" | "FAILED";
  error?: string;
}
