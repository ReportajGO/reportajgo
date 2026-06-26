import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { hasRefreshToken } from "../../integrations/higgsfield/oauth.js";
import { GeminiImageProvider } from "./geminiImage.js";
import { HiggsfieldProvider } from "./higgsfield.js";
import { HiggsfieldMcpProvider } from "./higgsfieldMcp.js";
import type { MediaProvider } from "./provider.js";

const log = logger.child({ module: "media" });
let cached: MediaProvider | undefined;

/**
 * Returns the configured primary media provider, selected by IMAGE_PROVIDER:
 *  - "higgsfield-mcp": Higgsfield via MCP (OAuth; subscription credit wallet).
 *  - "higgsfield": Soul images + DoP video via the Higgsfield REST API.
 *  - "gemini": images via the Gemini image model, stored locally (no video).
 * If the selected Higgsfield path isn't set up, we fall back to Gemini (with a
 * loud warning) so the pipeline keeps producing images. The per-request fallback
 * in mediaService additionally covers mid-run failures (e.g. credits exhausted).
 * Cached so we reuse one client across the process.
 */
export function getMediaProvider(): MediaProvider {
  if (cached) return cached;

  if (env.IMAGE_PROVIDER === "higgsfield-mcp") {
    if (hasRefreshToken()) {
      cached = new HiggsfieldMcpProvider();
    } else {
      log.warn(
        "IMAGE_PROVIDER=higgsfield-mcp but no refresh token — run `npm run higgsfield:login`. " +
          "Falling back to Gemini images for now.",
      );
      cached = new GeminiImageProvider();
    }
  } else if (env.IMAGE_PROVIDER === "higgsfield") {
    const creds = env.HIGGSFIELD_CREDENTIALS;
    if (creds && creds.includes(":")) {
      cached = new HiggsfieldProvider();
    } else {
      log.warn(
        "IMAGE_PROVIDER=higgsfield but HIGGSFIELD_CREDENTIALS is missing — " +
          "falling back to Gemini images. Set KEY_ID:KEY_SECRET from cloud.higgsfield.ai to use Higgsfield.",
      );
      cached = new GeminiImageProvider();
    }
  } else {
    cached = new GeminiImageProvider();
  }
  return cached;
}

export type { MediaProvider } from "./provider.js";
