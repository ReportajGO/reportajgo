import { describe, expect, it } from "vitest";
import { modelAspectRatio } from "../modelRatio.js";

// Soul 2.0's accepted list is 1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3 — no 4:5.
// The Instagram/Facebook card profiles ask for 4:5, so an unmapped request would
// be rejected by the model and strand the draft in PENDING_MEDIA.
describe("modelAspectRatio", () => {
  it("maps 4:5 to the nearest portrait Soul 2.0 actually supports", () => {
    expect(modelAspectRatio("soul_2", "4:5")).toBe("3:4");
  });

  it("passes Soul-supported ratios through untouched", () => {
    expect(modelAspectRatio("soul_2", "1:1")).toBe("1:1");
    expect(modelAspectRatio("soul_2", "16:9")).toBe("16:9");
    expect(modelAspectRatio("soul_2", "9:16")).toBe("9:16");
  });

  it("applies the fallback to every Soul variant, not just soul_2", () => {
    expect(modelAspectRatio("soul_cinematic", "4:5")).toBe("3:4");
  });

  it("leaves 4:5 alone for models that support it natively", () => {
    expect(modelAspectRatio("nano_banana_pro", "4:5")).toBe("4:5");
  });
});
