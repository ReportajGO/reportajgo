import { describe, expect, it, vi } from "vitest";
import { BRAND_STYLE, PURE_IMAGE_ESCALATION } from "../brandStyle.js";

// prompts.ts pulls in the Gemini client for describeScene; composePrompt itself
// is pure, so stub the module rather than requiring API config at import time.
vi.mock("../../../research/gemini.js", () => ({ generateText: vi.fn() }));

const { composePrompt } = await import("../prompts.js");

// Soul renders whatever visual furniture the prompt names. Asking for a caption
// bar got us a caption bar — filled with garbled pseudo-text. Every word on a
// ReportageGO post is composited by our own card template, so the generated
// asset must be a bare photograph.
describe("image prompt composition", () => {
  const scene = "A wide shot of an empty modern laboratory at dawn.";

  it("forbids rendered text in the image prompt", () => {
    const prompt = composePrompt(scene, "IMAGE");
    expect(prompt).toContain(BRAND_STYLE.pureImage);
    expect(prompt.toLowerCase()).toContain("no text");
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

  it("never asks the model for a caption bar or broadcast graphics", () => {
    const banned = ["caption bar", "lower-third bar", "chyron", "news ticker", "title card"];
    for (const type of ["IMAGE", "VIDEO"] as const) {
      const style = (type === "VIDEO" ? BRAND_STYLE.videoStyle : BRAND_STYLE.imageStyle).toLowerCase();
      for (const phrase of banned) {
        expect(style, `${type} style must not request "${phrase}"`).not.toContain(phrase);
      }
    }
  });

  it("escalates the no-text rule on each retry", () => {
    expect(PURE_IMAGE_ESCALATION[0]).toBe("");
    expect(PURE_IMAGE_ESCALATION.length).toBeGreaterThan(1);
    for (const step of PURE_IMAGE_ESCALATION.slice(1)) {
      expect(step.toLowerCase()).toMatch(/wordless|no text/);
    }
  });
});
