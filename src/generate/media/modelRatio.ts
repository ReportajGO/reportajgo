import type { AspectRatio } from "../../domain/types.js";

// Higgsfield Soul 2.0 accepts 1:1, 16:9, 9:16, 4:3, 3:4, 3:2 and 2:3 — but NOT
// 4:5, which the Instagram/Facebook card profiles ask for. Map it to the nearest
// portrait so a 4:5 request isn't rejected by the model.
const SOUL_RATIO_FALLBACK: Partial<Record<AspectRatio, string>> = { "4:5": "3:4" };

const isSoulModel = (model: string) => model.startsWith("soul");

/** The aspect ratio to send for `model` — our ratio, narrowed to what it supports. */
export function modelAspectRatio(model: string, ratio: AspectRatio): string {
  if (!isSoulModel(model)) return ratio;
  return SOUL_RATIO_FALLBACK[ratio] ?? ratio;
}
