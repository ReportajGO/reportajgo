import { describe, expect, it } from "vitest";
import {
  QUOTA_MIN_SAMPLE,
  UZ_QUOTA_BOUNDS,
  UZ_QUOTA_TARGET,
  UZ_QUOTA_TOLERANCE,
  assess,
  monthKey,
  monthStart,
  shouldPickUzbekistanNext,
  uzSlotsNeeded,
} from "../quota.js";

describe("Uzbekistan quota constants", () => {
  it("encodes the 20% ±2% rule from the concept document", () => {
    expect(UZ_QUOTA_TARGET).toBe(20);
    expect(UZ_QUOTA_TOLERANCE).toBe(2);
    expect(UZ_QUOTA_BOUNDS).toEqual({ min: 18, max: 22 });
  });
});

describe("assess", () => {
  it("reports ON_TARGET when the share sits inside the 18-22% band", () => {
    // Arrange: 20 of 100 published items are Uzbekistan content.
    // Act
    const result = assess(20, 100);
    // Assert
    expect(result.share).toBe(20);
    expect(result.drift).toBe(0);
    expect(result.verdict).toBe("ON_TARGET");
  });

  it("treats both edges of the tolerance band as on target", () => {
    expect(assess(18, 100).verdict).toBe("ON_TARGET");
    expect(assess(22, 100).verdict).toBe("ON_TARGET");
  });

  it("reports UNDER when the share falls below the band", () => {
    const result = assess(10, 100);
    expect(result.verdict).toBe("UNDER");
    expect(result.drift).toBe(-10);
  });

  it("reports OVER when the share exceeds the band", () => {
    const result = assess(35, 100);
    expect(result.verdict).toBe("OVER");
    expect(result.drift).toBe(15);
  });

  it("returns UNDETERMINED below the minimum sample, so a tiny month is not judged", () => {
    // With 4 items published, a single Uzbekistan post is already 25% — a
    // verdict here would be noise, not signal.
    const result = assess(1, 4);
    expect(result.share).toBe(25);
    expect(result.verdict).toBe("UNDETERMINED");
  });

  it("starts judging once the sample reaches the threshold", () => {
    expect(assess(4, QUOTA_MIN_SAMPLE).verdict).not.toBe("UNDETERMINED");
  });

  it("handles an empty month without dividing by zero", () => {
    const result = assess(0, 0);
    expect(result.share).toBe(0);
    expect(result.verdict).toBe("UNDETERMINED");
  });

  it("rejects impossible counts rather than reporting a share above 100%", () => {
    expect(() => assess(5, 3)).toThrow(/cannot exceed/);
    expect(() => assess(-1, 10)).toThrow(/negative/);
  });
});

describe("uzSlotsNeeded", () => {
  it("allocates the target share when starting from an empty month", () => {
    // 10 upcoming slots, nothing published yet → 20% of 10 = 2.
    expect(uzSlotsNeeded(0, 0, 10)).toBe(2);
  });

  it("allocates extra slots to recover from an under-filled quota", () => {
    // 0 of 80 published, 20 slots coming: target is 20% of 100 = 20 items, so all
    // 20 remaining slots should be Uzbekistan content.
    expect(uzSlotsNeeded(0, 80, 20)).toBe(20);
  });

  it("allocates nothing when already over the target", () => {
    // 30 of 100 already Uzbekistan; 10 more slots → target 20% of 110 = 22 < 30.
    expect(uzSlotsNeeded(30, 100, 10)).toBe(0);
  });

  it("never exceeds the number of available slots", () => {
    expect(uzSlotsNeeded(0, 1000, 5)).toBe(5);
  });

  it("returns zero for a non-positive slot count", () => {
    expect(uzSlotsNeeded(0, 100, 0)).toBe(0);
    expect(uzSlotsNeeded(0, 100, -3)).toBe(0);
  });

  it("keeps a balanced month balanced", () => {
    // Already at exactly 20%; 10 more slots should take 2 to stay on target.
    expect(uzSlotsNeeded(20, 100, 10)).toBe(2);
  });
});

describe("shouldPickUzbekistanNext", () => {
  it("claims the next slot when skipping it would drop below the lower bound", () => {
    // 18 of 100 is exactly at the floor; one more non-UZ item gives 17.8% < 18%.
    expect(shouldPickUzbekistanNext(18, 100)).toBe(true);
  });

  it("leaves the next slot free when there is headroom above the floor", () => {
    // 25 of 100 → skipping gives 24.75%, still well inside the band.
    expect(shouldPickUzbekistanNext(25, 100)).toBe(false);
  });
});

describe("month helpers", () => {
  it("derives the UTC month boundary and key", () => {
    const mid = new Date("2026-07-30T14:22:00.000Z");
    expect(monthStart(mid).toISOString()).toBe("2026-07-01T00:00:00.000Z");
    expect(monthKey(mid)).toBe("2026-07");
  });

  it("zero-pads single-digit months in the key", () => {
    expect(monthKey(new Date("2026-01-05T00:00:00.000Z"))).toBe("2026-01");
  });
});
