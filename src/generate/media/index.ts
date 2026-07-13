import { env } from "../../config/env.js";
import { hasRefreshToken } from "../../integrations/higgsfield/oauth.js";
import { GeminiImageProvider } from "./geminiImage.js";
import { HiggsfieldProvider } from "./higgsfield.js";
import { HiggsfieldMcpProvider } from "./higgsfieldMcp.js";
import type { MediaProvider } from "./provider.js";

let cached: MediaProvider | undefined;

/**
 * Returns the image provider. Images are generated with **Higgsfield only** —
 * there is no Gemini image fallback. Selected by IMAGE_PROVIDER:
 *  - "higgsfield-mcp": Higgsfield via MCP (OAuth; subscription credit wallet).
 *  - "higgsfield": Soul images + DoP video via the Higgsfield REST API.
 * Misconfiguration throws loudly rather than silently switching providers.
 * (Gemini is still used elsewhere for research/copy/vision — just not images.)
 * Cached so we reuse one client across the process.
 */
export function getMediaProvider(): MediaProvider {
  if (cached) return cached;

  if (env.IMAGE_PROVIDER === "gemini") {
    cached = new GeminiImageProvider();
  } else if (env.IMAGE_PROVIDER === "higgsfield-mcp") {
    if (!hasRefreshToken()) {
      throw new Error(
        "IMAGE_PROVIDER=higgsfield-mcp but no refresh token — run `npm run higgsfield:login`.",
      );
    }
    cached = new HiggsfieldMcpProvider();
  } else if (env.IMAGE_PROVIDER === "higgsfield") {
    const creds = env.HIGGSFIELD_CREDENTIALS;
    if (!creds || !creds.includes(":")) {
      throw new Error(
        "IMAGE_PROVIDER=higgsfield but HIGGSFIELD_CREDENTIALS (KEY_ID:KEY_SECRET) is missing.",
      );
    }
    cached = new HiggsfieldProvider();
  } else {
    throw new Error(
      `IMAGE_PROVIDER must be 'gemini', 'higgsfield-mcp', or 'higgsfield'; got '${env.IMAGE_PROVIDER}'.`,
    );
  }
  return cached;
}

export type { MediaProvider } from "./provider.js";
