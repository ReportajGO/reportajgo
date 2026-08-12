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
   * image model.
   *
   * Written as a DESCRIPTION OF THE SCENE, not as a list of banned graphics.
   * The prompt is a single positive field (Soul takes no negative input), and an
   * image model weights the nouns it is given regardless of the "no" in front of
   * them: a prompt naming lower thirds, chyrons, tickers, captions, watermarks,
   * posters and newspapers is a prompt that describes an image full of exactly
   * those, which is how posts ended up with colour-coded caption bars full of
   * garbled pseudo-text. Name only what the frame SHOULD contain — plain,
   * unmarked surfaces — and let one short closing rule carry the prohibition.
   */
  pureImage: string;
}

// Appended one at a time when a generation still comes back with writing on it.
// Each step gets more CONCRETE about what the surfaces look like rather than
// louder about the ban — repeating "no text! zero characters!" just re-seeds the
// model with the idea of text. Index 0 is the baseline.
export const PURE_IMAGE_ESCALATION: readonly string[] = [
  "",
  "Every surface in the frame is smooth, plain and completely blank.",
  "Shoot the scene so nothing printable is in view: bare walls and matte panels, " +
    "plain unmarked packaging, dark switched-off screens, and any distant surface " +
    "far enough out of focus to read as texture alone.",
];

export const BRAND_STYLE: BrandStyle = {
  brandName: "ReportageGO",

  imageStyle: [
    "Editorial news photograph.",
    "Clean composition, realistic documentary photography,",
    "neutral balanced lighting, high detail, 4k, sharp focus.",
    // "Keep the lower third uncluttered" used to live here. Naming the lower
    // third is how you get a lower third: the model read it as a region of the
    // layout to fill and drew a caption bar across it. Describe the bottom of
    // the frame as part of the place instead.
    "The bottom of the frame is open and simple — floor, ground or plain surface.",
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
    "A single straight photograph, exactly as it came out of the camera,",
    "with no graphic design applied over it.",
    "The location is plain and unbranded: bare walls, matte panels,",
    "smooth blank packaging, and screens that are switched off and dark.",
    "Nothing in the frame is printed, written or drawn on.",
  ].join(" "),
};
