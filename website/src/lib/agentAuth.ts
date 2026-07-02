/**
 * Machine-to-machine auth for the ReportajGO AI agent.
 *
 * The agent is not a browser, so it authenticates with a static bearer token
 * (AGENT_API_KEY) instead of a NextAuth session. Keep this key secret — anyone
 * holding it can publish news to the site.
 */
import { timingSafeEqual } from "node:crypto";

const API_KEY = process.env.AGENT_API_KEY ?? "";

/** Constant-time string comparison (avoids leaking the key via timing). */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** Extract the bearer token from the Authorization header (or `x-api-key`). */
function extractKey(req: Request): string | null {
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7).trim();
  const x = req.headers.get("x-api-key");
  return x ? x.trim() : null;
}

export type ApiKeyCheck =
  | { ok: true }
  | { ok: false; status: number; error: string };

/** Verify the request carries a valid agent API key. */
export function checkApiKey(req: Request): ApiKeyCheck {
  if (!API_KEY) {
    // Locked down by default: no key configured = endpoint refuses everyone.
    return { ok: false, status: 503, error: "Agent API key not configured" };
  }
  const provided = extractKey(req);
  if (!provided) return { ok: false, status: 401, error: "Missing API key" };
  if (!safeEqual(provided, API_KEY))
    return { ok: false, status: 403, error: "Invalid API key" };
  return { ok: true };
}
