// Shared paths/constants for the Instagram web automation (mirrors the Canva
// renderer's setup: one persistent, logged-in Chromium profile reused headless).
import { isAbsolute, resolve } from "node:path";
import { env } from "../../config/env.js";

function abs(p: string): string {
  return isAbsolute(p) ? p : resolve(process.cwd(), p);
}

export const INSTAGRAM_PROFILE_DIR = abs(env.INSTAGRAM_PROFILE_DIR);
export const INSTAGRAM_DEBUG_DIR = abs(env.INSTAGRAM_DEBUG_DIR);

// A typical desktop viewport — Instagram's web "Create" flow only exists on the
// desktop layout, so keep this wide.
export const VIEWPORT = { width: 1280, height: 900 } as const;
