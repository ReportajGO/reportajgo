// Helpers for the editorial priority level (BREAKING > HIGH > NORMAL > LOW).
// Kept UI-agnostic: no HTML/emoji formatting lives here (callers decide how to
// render), only the ordering and coercion logic used across the pipeline.
import type { NewsPriority } from "./types.js";

// Severity order, lowest → highest. Array index doubles as the numeric rank.
export const PRIORITY_LEVELS = ["LOW", "NORMAL", "HIGH", "BREAKING"] as const;

export function isNewsPriority(value: unknown): value is NewsPriority {
  return (
    typeof value === "string" &&
    (PRIORITY_LEVELS as readonly string[]).includes(value)
  );
}

/** Numeric severity (LOW=0 … BREAKING=3) for comparisons and sorting. */
export function priorityRank(p: NewsPriority): number {
  return (PRIORITY_LEVELS as readonly string[]).indexOf(p);
}

/** True when `p` is at least as high-priority as `min`. */
export function meetsMinPriority(p: NewsPriority, min: NewsPriority): boolean {
  return priorityRank(p) >= priorityRank(min);
}

/** Fallback mapping from a 0..1 score to a level, when the model omits one. */
export function scoreToPriority(score: number): NewsPriority {
  if (score >= 0.85) return "BREAKING";
  if (score >= 0.7) return "HIGH";
  if (score >= 0.5) return "NORMAL";
  return "LOW";
}

/** Coerce arbitrary model output to a valid level, deriving from score if unusable. */
export function coercePriority(raw: unknown, score: number): NewsPriority {
  if (typeof raw === "string") {
    const up = raw.trim().toUpperCase();
    if (isNewsPriority(up)) return up;
  }
  return scoreToPriority(score);
}
