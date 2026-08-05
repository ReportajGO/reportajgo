// ─────────────────────────────────────────────────────────────────────────────
// BRAND / "OFFICIAL LOOK" STYLE TEMPLATE
//
// This is the single place that defines how ReportageGO's official news images
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
  /**
   * Always appended: the generated asset must be a bare photograph. Every word
   * on a ReportageGO post comes from our own card template, never from the
   * image model — models asked for "news graphics" happily invent lower-third
   * bars filled with garbled pseudo-text.
   *
   * Soul exposes no negative-prompt input, so this has to be positive-phrased
   * text inside the prompt itself — a separate `negative` field would just sit
   * there unsent, which is how the caption-bar regression survived this long.
   */
  pureImage: string;
}

// Escalating restatements of the no-text rule, appended one at a time when a
// generation still comes back with words on it. Index 0 is the baseline.
export const PURE_IMAGE_ESCALATION: readonly string[] = [
  "",
  "CRITICAL: the image must be completely wordless. Zero characters of any alphabet anywhere.",
  "Absolutely no text of any kind. Show only physical objects, people, and environments with " +
    "blank, unmarked, text-free surfaces. Any screen, sign, page, or panel in frame must be " +
    "empty, switched off, abstract, or out of focus beyond legibility.",
];

export const BRAND_STYLE: BrandStyle = {
  brandName: "ReportageGO",

  imageStyle: [
    "Editorial news photograph.",
    "Clean composition, realistic documentary photography,",
    "neutral balanced lighting, high detail, 4k, sharp focus.",
    "Keep the lower third calm and uncluttered — plain, simple surfaces there.",
  ].join(" "),

  videoStyle: [
    "Documentary b-roll footage, filmed on a real camera.",
    "Subtle, steady cinematic camera motion (slow push-in or gentle pan).",
    "Realistic, documentary tone. No fast cuts. Stable horizon.",
  ].join(" "),

  guardrails: [
    "Do not depict real identifiable public figures in fabricated situations.",
    "Avoid graphic, violent, or misleading imagery.",
    "Generic, representative scenes only — this is an illustrative visual, not",
    "a photograph of the actual event.",
  ].join(" "),

  pureImage: [
    "No text, no words, no letters, no numbers, no captions, no subtitles,",
    "no signage, no labels, no headlines, no watermark, no logos, no typography anywhere.",
    "No broadcast graphics: no lower-third bars, no chyrons, no news tickers, no UI overlays,",
    "no title cards, no framing borders.",
    "No screens, monitors, or displays showing text, code, or interfaces;",
    "no newspapers, books, posters, banners, whiteboards, or documents with writing.",
    "A bare photograph only.",
  ].join(" "),
};
