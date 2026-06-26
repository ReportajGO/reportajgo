// ─────────────────────────────────────────────────────────────────────────────
// BRAND / "OFFICIAL LOOK" STYLE TEMPLATE
//
// This is the single place that defines how ReportajGO's official news images
// and videos look. The media prompt builder injects these strings into every
// Higgsfield generation request.
//
// 👉 THIS IS THE "TRAINING" HOOK. When you tell me the official style for your
//    news report videos / post images, we encode it here — fonts, color story,
//    framing, lower-thirds, motion, logo placement, tone — and every generated
//    asset inherits it automatically.
//
// Until then, these are sensible, neutral news-channel defaults.
// ─────────────────────────────────────────────────────────────────────────────

export interface BrandStyle {
  /** Channel/brand name, surfaced in overlays/captions. */
  brandName: string;
  /** Visual identity applied to every IMAGE prompt. */
  imageStyle: string;
  /** Visual + motion identity applied to every VIDEO prompt. */
  videoStyle: string;
  /** Always appended — keeps factual news imagery responsible. */
  guardrails: string;
  /** Negative prompt: things that must never appear. */
  negative: string;
}

export const BRAND_STYLE: BrandStyle = {
  brandName: "ReportajGO",

  imageStyle: [
    "Professional news-channel key visual.",
    "Clean editorial composition, realistic photojournalistic style,",
    "neutral balanced lighting, high detail, 4k, sharp focus.",
    "Leave clear negative space in the lower third for a caption bar.",
  ].join(" "),

  videoStyle: [
    "Broadcast-quality news b-roll.",
    "Subtle, steady cinematic camera motion (slow push-in or gentle pan).",
    "Realistic, documentary tone. No fast cuts. Stable horizon.",
  ].join(" "),

  guardrails: [
    "Do not depict real identifiable public figures in fabricated situations.",
    "Avoid graphic, violent, or misleading imagery.",
    "Generic, representative scenes only — this is an illustrative visual, not",
    "a photograph of the actual event.",
  ].join(" "),

  negative:
    "text artifacts, garbled text, watermark, logo, distorted faces, extra limbs, lowres, blurry",
};
