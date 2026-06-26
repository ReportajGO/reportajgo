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
    "",
    `Title: ${news.title}`,
    `Summary: ${news.summary}`,
    "",
    "Return ONLY the scene description, no preamble.",
  ].join("\n");

  const scene = await generateText(prompt, 0.6);
  return scene.replace(/\s+/g, " ").trim();
}

/** Compose the final generation prompt from a scene + brand style. */
export function composePrompt(scene: string, type: MediaType): string {
  const style = type === "VIDEO" ? BRAND_STYLE.videoStyle : BRAND_STYLE.imageStyle;
  return [scene, style, BRAND_STYLE.guardrails].join(" ");
}
