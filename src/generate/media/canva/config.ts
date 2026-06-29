// Shared paths/constants for the Canva editor automation.
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { env } from "../../../config/env.js";

function abs(p: string): string {
  return isAbsolute(p) ? p : resolve(process.cwd(), p);
}

export const CANVA_PROFILE_DIR = abs(env.CANVA_PROFILE_DIR);
export const CANVA_DEBUG_DIR = abs(env.CANVA_DEBUG_DIR);
export const CANVA_TEMPLATE_MAP_PATH = abs(env.CANVA_TEMPLATE_MAP);

/**
 * Calibration map for a specific template. Coordinates are in CSS pixels
 * relative to the editor viewport at VIEWPORT size below. Produced/edited during
 * a calibration session against the real template.
 */
export interface CanvaTemplateMap {
  /** Headline text element: where to double-click to enter edit mode. */
  headline?: { x: number; y: number };
  /** Image frame element: where to click to select it before replacing. */
  imageFrame?: { x: number; y: number };
  /** Optional: where the just-uploaded thumbnail appears, to click/apply it. */
  uploadThumb?: { x: number; y: number };
}

// The editor viewport the calibration coordinates are captured against. Keep
// this fixed so coordinates stay valid across runs.
export const VIEWPORT = { width: 1440, height: 1024 } as const;

export function loadTemplateMap(): CanvaTemplateMap {
  if (!existsSync(CANVA_TEMPLATE_MAP_PATH)) return {};
  try {
    return JSON.parse(readFileSync(CANVA_TEMPLATE_MAP_PATH, "utf8")) as CanvaTemplateMap;
  } catch {
    return {};
  }
}
