import type { AspectRatio, MediaResult } from "../../domain/types.js";

export interface ImageGenRequest {
  prompt: string;
  aspectRatio: AspectRatio;
  negativePrompt?: string;
  seed?: number;
}

export interface VideoGenRequest {
  prompt: string;
  aspectRatio: AspectRatio;
  /** When provided, animate this image (image-to-video). Otherwise text-to-video. */
  sourceImageUrl?: string;
  seed?: number;
}

/**
 * Transport-agnostic media generation. Implementations: Higgsfield (primary),
 * and optional fallbacks (fal/replicate). Keeping this interface narrow lets us
 * swap providers without touching the pipeline.
 */
export interface MediaProvider {
  readonly name: string;
  generateImage(req: ImageGenRequest): Promise<MediaResult>;
  generateVideo(req: VideoGenRequest): Promise<MediaResult>;
}
