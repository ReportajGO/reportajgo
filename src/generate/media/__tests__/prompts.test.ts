import { describe, expect, it, vi } from "vitest";
import { BRAND_STYLE, PURE_IMAGE_ESCALATION } from "../brandStyle.js";

// prompts.ts pulls in the Gemini client for describeScene; composePrompt itself
// is pure, so stub the module rather than requiring API config at import time.
vi.mock("../../../research/gemini.js", () => ({ generateText: vi.fn() }));

const { composePrompt } = await import("../prompts.js");

// An image model renders whatever visual furniture the prompt NAMES, whether or
// not the word "no" precedes it: a prompt listing captions, chyrons, tickers and
// watermarks describes an image full of them, which is how posts ended up with
// colour-coded caption bars of garbled pseudo-text. So the rule is not "ban it
// louder" — it is "never say the word". Every prompt describes blank surfaces
// instead, and every ReportageGO word is composited by our own card template.
const FURNITURE = [
  "caption",
  "chyron",
  "lower third",
  "lower-third",
  "ticker",
  "subtitle",
  "watermark",
  "title card",
  "typography",
  "logo",
  "newspaper",
  "poster",
  "banner",
  "whiteboard",
];

describe("image prompt composition", () => {
  const scene = "A wide shot of an empty modern laboratory at dawn.";

  it("states the no-writing rule in the image prompt", () => {
    const prompt = composePrompt(scene, "IMAGE");
    expect(prompt).toContain(BRAND_STYLE.pureImage);
    expect(prompt.toLowerCase()).toContain("printed, written or drawn on");
  });

  it("forbids rendered text in the video prompt too", () => {
    const prompt = composePrompt(scene, "VIDEO");
    expect(prompt).toContain(BRAND_STYLE.pureImage);
  });

  it("keeps the scene and the brand guardrails", () => {
    const prompt = composePrompt(scene, "IMAGE");
    expect(prompt).toContain(scene);
    expect(prompt).toContain(BRAND_STYLE.guardrails);
  });

  it("never names broadcast furniture anywhere in the prompt", () => {
    for (const type of ["IMAGE", "VIDEO"] as const) {
      // The whole prompt, not just the style block: naming the furniture is just
      // as costly in the pure-image rule that was meant to forbid it.
      const prompt = composePrompt(scene, type).toLowerCase();
      for (const phrase of FURNITURE) {
        expect(prompt, `${type} prompt must not name "${phrase}"`).not.toContain(phrase);
      }
    }
  });

  it("escalates by describing the surfaces, not by repeating the ban", () => {
    expect(PURE_IMAGE_ESCALATION[0]).toBe("");
    expect(PURE_IMAGE_ESCALATION.length).toBeGreaterThan(1);
    for (const step of PURE_IMAGE_ESCALATION.slice(1)) {
      const lower = step.toLowerCase();
      expect(lower).toMatch(/blank|plain|bare|matte|switched off/);
      for (const phrase of FURNITURE) {
        expect(lower, `escalation must not name "${phrase}"`).not.toContain(phrase);
      }
    }
  });
});
