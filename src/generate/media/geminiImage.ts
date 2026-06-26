import { GoogleGenAI } from "@google/genai";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { withGeminiRetry } from "../../research/gemini.js";
import type { AspectRatio, MediaResult } from "../../domain/types.js";
import { saveImage } from "./mediaStore.js";
import type { ImageGenRequest, MediaProvider, VideoGenRequest } from "./provider.js";

const log = logger.child({ module: "gemini-image" });
const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

// Map our platform aspect ratios to the ratios Gemini's image model supports.
// Gemini supports 1:1, 3:4, 4:3, 9:16, 16:9, 2:3, 3:2, 21:9 — there is no 4:5,
// so we use the nearest portrait (3:4).
const ASPECT_BY_RATIO: Record<AspectRatio, string> = {
  "1:1": "1:1",
  "16:9": "16:9",
  "9:16": "9:16",
  "4:5": "3:4",
};

/**
 * Image generation via Gemini's image model (e.g. gemini-2.5-flash-image).
 * Returns inline image bytes which we persist locally and serve as a URL.
 * Video is not supported here — use Higgsfield for video platforms.
 */
export class GeminiImageProvider implements MediaProvider {
  readonly name = "gemini";

  async generateImage(req: ImageGenRequest): Promise<MediaResult> {
    try {
      const response = await withGeminiRetry(() =>
        ai.models.generateContent({
          model: env.GEMINI_IMAGE_MODEL,
          contents: req.prompt,
          config: {
            responseModalities: ["IMAGE"],
            imageConfig: { aspectRatio: ASPECT_BY_RATIO[req.aspectRatio] },
          },
        }),
      );

      const parts = response.candidates?.[0]?.content?.parts ?? [];
      const inline = parts.find((p) => p.inlineData?.data)?.inlineData;
      if (!inline?.data) {
        const note = response.text?.trim();
        throw new Error(
          note ? `no image returned (model said: ${note.slice(0, 160)})` : "no image data in response",
        );
      }

      const stored = await saveImage(inline.data, inline.mimeType ?? "image/png");
      log.info({ url: stored.url, model: env.GEMINI_IMAGE_MODEL }, "gemini image ready");
      return {
        provider: this.name,
        type: "IMAGE",
        aspectRatio: req.aspectRatio,
        url: stored.url,
        status: "READY",
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error({ err: message }, "gemini image generation failed");
      return { provider: this.name, type: "IMAGE", aspectRatio: req.aspectRatio, status: "FAILED", error: message };
    }
  }

  async generateVideo(req: VideoGenRequest): Promise<MediaResult> {
    return {
      provider: this.name,
      type: "VIDEO",
      aspectRatio: req.aspectRatio,
      status: "FAILED",
      error:
        "Gemini image provider does not generate video. Set IMAGE_PROVIDER=higgsfield (with HIGGSFIELD_CREDENTIALS) for video platforms.",
    };
  }
}
