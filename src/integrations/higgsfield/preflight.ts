import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { mcpCallTool } from "./mcpClient.js";
import { hasRefreshToken } from "./oauth.js";

const log = logger.child({ module: "higgsfield-preflight" });

interface Balance {
  credits?: number;
  subscription_plan_type?: string;
}

/**
 * Boot-time self-check for image generation. Confirms the Higgsfield token is
 * present and actually works (calls `balance`), and logs the credit balance —
 * or the exact failure. NON-FATAL: it never throws, so a bad token doesn't crash
 * the worker; instead the logs make it obvious WHY images would fail (missing
 * token, expired refresh token, or network/"fetch failed" reaching the MCP host).
 *
 * Only relevant to the higgsfield-mcp provider (the one that draws on the
 * subscription wallet); other providers are skipped.
 */
export async function higgsfieldPreflight(): Promise<void> {
  if (env.IMAGE_PROVIDER !== "higgsfield-mcp") return;

  if (!hasRefreshToken()) {
    log.error(
      "Higgsfield NOT configured: no refresh token found. Mount .secrets/higgsfield-oauth.json " +
        "into the worker, or set HIGGSFIELD_CLIENT_ID + HIGGSFIELD_REFRESH_TOKEN. Images will FAIL until fixed.",
    );
    return;
  }

  try {
    const bal = (await mcpCallTool("balance", {})) as Balance;
    log.info(
      { credits: bal.credits, plan: bal.subscription_plan_type },
      "Higgsfield preflight OK — image generation is ready",
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(
      { err: message },
      "Higgsfield preflight FAILED — images will not generate. Check the token/network " +
        '(a "fetch failed" here usually means the container cannot reach mcp.higgsfield.ai).',
    );
  }
}
