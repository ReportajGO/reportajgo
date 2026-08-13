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
  "Hold the frame on bare walls, matte panels and open floor, with every distant " +
    "surface far enough out of focus to read as texture alone.",
  // The last two steps stop describing the surfaces and change the shot itself.
  // By here the model has ignored the rule three times, so the fix is to frame
  // something that physically cannot carry writing rather than ask again.
  "Frame in close on material and texture alone — skin, fabric, foliage, metal, " +
    "stone, water — with the background thrown into a plain wash of shallow " +
    "depth of field.",
  "Shoot outdoors in open natural surroundings — sky, land, water, foliage, " +
    "weather — where every plane in view is bare ground or plain daylight and " +
    "nothing manufactured stands close enough to be legible.",
];

export const BRAND_STYLE: BrandStyle = {
  brandName: "ReportageGO",

  imageStyle: [
    // Not "editorial": that word describes a MAGAZINE, and the model obliged
    // with printed spreads — a photo mounted on a folded page, fake columns of
    // fine print down the side. Name the camera, not the publication.
    "Documentary photograph taken on a 35mm camera with a fast prime lens.",
    "Natural available light, true colour, high detail, sharp focus.",
    // The scene must BE the picture. Left unsaid, the model kept photographing
    // the picture as an object inside another room — a giant display standing
    // against a gallery wall, a print in a mount.
    "The scene itself fills the frame corner to corner, nothing around it.",
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

  // Every noun here was measured. The previous version read "no graphic design
  // applied over it… screens that are switched off… plain and unbranded", and
  // the model rendered a magazine spread, a giant display in a gallery, and
  // invented wordmarks — one artefact per noun, in the very sentence meant to
  // prevent them. A negation is still a mention, and a mention is an
  // instruction. So this says only what the frame IS made of: material.
  pureImage: [
    "A single straight photograph, exactly as it came out of the camera.",
    "Every surface in view is bare material — stone, metal, glass, fabric,",
    "foliage, skin, soil, water, concrete — smooth, clean and evenly lit.",
  ].join(" "),
};
