import type { MediaType } from "../../domain/types.js";
import { generateText } from "../../research/gemini.js";
import { BRAND_STYLE } from "./brandStyle.js";

interface NewsForVisual {
  title: string;
  summary: string;
  topic?: string | null;
}

/**
 * Turn a news item into a concrete, safe VISUAL SCENE description.
 * Raw headlines make poor image prompts (abstract, name real people), so we
 * ask Gemini for a representative, non-defamatory scene first.
 */
export async function describeScene(news: NewsForVisual): Promise<string> {
  const prompt = [
    "You write image-generation scene descriptions for an illustrative news visual.",
    "Given the news below, describe ONE concrete, representative scene in 1-2 sentences.",
    "Rules:",
    "- Do NOT name or depict real, identifiable people.",
    "- Describe a generic, symbolic, or location-based scene that evokes the topic.",
    "- Visual nouns only (place, objects, atmosphere, time of day). No opinions.",
    "- The SUBJECT itself must not be a writing surface. A notebook, ledger, contract,",
    "  document, newspaper, whiteboard, screen, sign or poster cannot be the thing the",
    "  picture is about — an image model asked for one fills it with invented scribble.",
    "  For a story about money, deals or paperwork, photograph the PLACE or the",
    "  PHYSICAL OBJECTS instead: a trading floor, a port, a workshop, a skyline,",
    "  machinery, hands handling goods or tools.",
    "- CHOOSE A PLACE THAT HAS NOTHING TO WRITE ON. Open landscape, sky and weather,",
    "  water, farmland, a distant skyline, a construction frame, or a close view of",
    "  hands, tools, materials, machinery detail or plant life. These are the scenes",
    "  an image model renders cleanly.",
    "- AVOID INTERIORS OF LABS, OFFICES, CLASSROOMS, SHOPS, WAREHOUSES AND CONFERENCE",
    "  ROOMS. Those rooms are lined with labels, posters, screens and equipment badges;",
    "  the model invents every one of them as garbled lettering. Go outside, or move",
    "  close enough that only material and texture fill the frame.",
    // The scene text is pasted straight into the image prompt, so it falls under the
    // same rule as the brand style: a negation still NAMES the thing. "Unbranded
    // glassware" is a request for branding — it is how a lab bench came back
    // carrying an invented logo and a wall of fake fine print.
    "- Describe only what IS there. Never write 'unbranded', 'blank', 'no text', 'no",
    "  logos' or any other negation — naming a thing in order to forbid it is still",
    "  naming it, and the image model draws what it reads.",
    "",
    `Title: ${news.title}`,
    `Summary: ${news.summary}`,
    "",
    "Return ONLY the scene description, no preamble.",
  ].join("\n");

  const scene = await generateText(prompt, 0.6);
  return scene.replace(/\s+/g, " ").trim();
}

/**
 * Compose the final generation prompt from a scene + brand style. The
 * pure-image rule is part of every prompt, image and video alike: all
 * ReportageGO wording is composited by our own card template afterwards, so a
 * model that renders its own caption bar can only produce garbled pseudo-text.
 */
export function composePrompt(scene: string, type: MediaType): string {
  const style = type === "VIDEO" ? BRAND_STYLE.videoStyle : BRAND_STYLE.imageStyle;
  return [scene, style, BRAND_STYLE.guardrails, BRAND_STYLE.pureImage].join(" ");
}
