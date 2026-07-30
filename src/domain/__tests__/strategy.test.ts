import { describe, expect, it } from "vitest";
import {
  MARKETS,
  allMarketCodes,
  allPublicationLanguages,
  findMarket,
  isMarketCode,
  isRtlLanguage,
  marketOf,
  marketsInRegion,
  marketsUpToPhase,
} from "../markets.js";
import {
  TOTAL_TARGET_SHARE,
  VERTICALS,
  mixReport,
  verticalForDay,
  verticalsForRun,
} from "../verticals.js";
import { FORMATS, FORMAT_FAMILIES, TOTAL_FORMAT_SHARE, nextFormat } from "../formats.js";
import type { ContentFormat, Vertical } from "../types.js";

describe("market matrix", () => {
  it("covers exactly 21 markets", () => {
    // The concept document's printed list repeats "19"; the real coverage is 21.
    expect(MARKETS).toHaveLength(21);
    expect(allMarketCodes()).toHaveLength(21);
  });

  it("uses unique market codes", () => {
    const codes = allMarketCodes();
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("gives every market a language and at least three platforms", () => {
    // TZ §8 requires one video, one social/community and one professional channel.
    for (const m of MARKETS) {
      expect(m.primaryLanguage.trim()).not.toBe("");
      expect(m.platforms.length).toBeGreaterThanOrEqual(3);
      expect(m.localizationNote.trim()).not.toBe("");
    }
  });

  it("keeps the Chinese and Taiwanese scripts strictly separate", () => {
    // Reusing one version for both is called out explicitly in TZ §11.
    expect(marketOf("CN").primaryLanguage).toBe("zh-Hans");
    expect(marketOf("TW").primaryLanguage).toBe("zh-Hant");
  });

  it("gives Canada both official languages", () => {
    const ca = marketOf("CA");
    expect(ca.primaryLanguage).toBe("en");
    expect(ca.secondaryLanguage).toBe("fr");
  });

  it("pairs every Gulf market with an English B2B track", () => {
    for (const code of ["AE", "KW", "QA", "OM", "SA"]) {
      const m = marketOf(code);
      expect(m.primaryLanguage).toBe("ar");
      expect(m.secondaryLanguage).toBe("en");
    }
  });

  it("activates the six pilot markets at phase 1", () => {
    const phase1 = marketsUpToPhase(1).map((m) => m.code);
    expect(phase1).toEqual(expect.arrayContaining(["JP", "KR", "CN", "MY", "TR", "AE"]));
    expect(phase1).toHaveLength(6);
  });

  it("reaches all 21 markets by phase 3", () => {
    expect(marketsUpToPhase(3)).toHaveLength(21);
  });

  it("grows monotonically across phases", () => {
    expect(marketsUpToPhase(1).length).toBeLessThan(marketsUpToPhase(2).length);
    expect(marketsUpToPhase(2).length).toBeLessThan(marketsUpToPhase(3).length);
  });

  it("assigns every market to exactly one of the four regions", () => {
    const total =
      marketsInRegion("APAC").length +
      marketsInRegion("EUROPE").length +
      marketsInRegion("MENA").length +
      marketsInRegion("AMERICAS").length;
    expect(total).toBe(21);
  });

  it("looks markets up case-insensitively and rejects unknown codes", () => {
    expect(findMarket("jp")?.code).toBe("JP");
    expect(findMarket("ZZ")).toBeUndefined();
    expect(isMarketCode("BR")).toBe(true);
    expect(isMarketCode("ZZ")).toBe(false);
    expect(() => marketOf("ZZ")).toThrow(/unknown market/);
  });

  it("reports the full publication language set including B2B languages", () => {
    const langs = allPublicationLanguages();
    expect(langs).toEqual(expect.arrayContaining(["ja", "ko", "ar", "zh-Hans", "zh-Hant", "pt-BR"]));
    // Spanish appears as the US secondary language and as Spain's primary.
    expect(langs).toContain("es");
  });

  it("identifies right-to-left languages for RTL layout", () => {
    expect(isRtlLanguage("ar")).toBe(true);
    expect(isRtlLanguage("en")).toBe(false);
    expect(isRtlLanguage("ja")).toBe(false);
  });
});

describe("vertical shares", () => {
  it("sums the seven target shares to exactly 100%", () => {
    expect(VERTICALS).toHaveLength(7);
    expect(TOTAL_TARGET_SHARE).toBe(100);
  });

  it("matches the shares specified in the concept document", () => {
    const byId = Object.fromEntries(VERTICALS.map((v) => [v.id, v.targetShare]));
    expect(byId).toEqual({
      ECONOMY: 25,
      INNOVATION: 15,
      SCIENCE: 15,
      STARTUP: 15,
      PEOPLE: 15,
      FACTS: 8,
      HISTORY: 7,
    });
  });
});

describe("verticalsForRun", () => {
  it("leads with economy when there is no history to balance against", () => {
    // Empty history → every vertical sits at its full target, so the order is
    // share-descending and the largest share leads.
    const picked = verticalsForRun({}, 1);
    expect(picked).toEqual(["ECONOMY"]);
  });

  it("prefers the vertical furthest below its target share", () => {
    // Economy is heavily over-published; science has had nothing.
    const counts: Partial<Record<Vertical, number>> = { ECONOMY: 90, SCIENCE: 0 };
    const picked = verticalsForRun(counts, 1);
    expect(picked[0]).not.toBe("ECONOMY");
  });

  it("puts the weekday's rhythm vertical first regardless of deficit", () => {
    const counts: Partial<Record<Vertical, number>> = { HISTORY: 500 };
    const picked = verticalsForRun(counts, 3, "HISTORY");
    expect(picked[0]).toBe("HISTORY");
  });

  it("does not repeat the lead vertical later in the same run", () => {
    const picked = verticalsForRun({}, 4, "FACTS");
    expect(picked.filter((v) => v === "FACTS")).toHaveLength(1);
  });

  it("honours the requested slot count and never exceeds the vertical count", () => {
    expect(verticalsForRun({}, 3)).toHaveLength(3);
    expect(verticalsForRun({}, 99)).toHaveLength(7);
    expect(verticalsForRun({}, 0)).toEqual([]);
  });
});

describe("weekly rhythm", () => {
  it("follows the published day-to-vertical plan", () => {
    // 2026-07-27 is a Monday.
    expect(verticalForDay(new Date(2026, 6, 27))).toBe("ECONOMY"); // Mon
    expect(verticalForDay(new Date(2026, 6, 28))).toBe("SCIENCE"); // Tue
    expect(verticalForDay(new Date(2026, 6, 29))).toBe("STARTUP"); // Wed
    expect(verticalForDay(new Date(2026, 6, 31))).toBe("PEOPLE"); // Fri
    expect(verticalForDay(new Date(2026, 7, 1))).toBe("FACTS"); // Sat
    expect(verticalForDay(new Date(2026, 7, 2))).toBe("HISTORY"); // Sun
  });
});

describe("mixReport", () => {
  it("reports drift against each target share", () => {
    const report = mixReport({ ECONOMY: 50, FACTS: 50 });
    const economy = report.find((r) => r.vertical === "ECONOMY")!;
    const facts = report.find((r) => r.vertical === "FACTS")!;
    expect(economy.actual).toBe(50);
    expect(economy.drift).toBe(25); // 50% actual vs 25% target
    expect(facts.drift).toBe(42); // 50% actual vs 8% target
  });

  it("reports zero actuals for an empty history without dividing by zero", () => {
    const report = mixReport({});
    expect(report).toHaveLength(7);
    expect(report.every((r) => r.actual === 0)).toBe(true);
  });
});

describe("format mix", () => {
  it("sums format target shares to exactly 100%", () => {
    expect(TOTAL_FORMAT_SHARE).toBe(100);
  });

  it("keeps the network video-first at 60%", () => {
    const video = FORMAT_FAMILIES.find((f) => f.name === "video")!;
    expect(video.share).toBe(60);
    const videoTotal = FORMATS.filter((f) => video.formats.includes(f.id)).reduce(
      (sum, f) => sum + f.targetShare,
      0,
    );
    expect(videoTotal).toBe(60);
  });

  it("sums the family shares to 100% as well", () => {
    expect(FORMAT_FAMILIES.reduce((s, f) => s + f.share, 0)).toBe(100);
  });

  it("gives every video format a duration bound", () => {
    for (const f of FORMATS) {
      if (f.media?.type === "VIDEO" && f.id !== "INTERVIEW") {
        expect(f.durationSec).toBeDefined();
      }
    }
  });
});

describe("nextFormat", () => {
  it("picks the highest-share format when there is no history", () => {
    expect(nextFormat({})).toBe("SHORT_VIDEO");
  });

  it("picks the format furthest below its target share", () => {
    // Short video is saturated, so the next slot should go elsewhere.
    const counts: Partial<Record<ContentFormat, number>> = { SHORT_VIDEO: 100 };
    expect(nextFormat(counts)).not.toBe("SHORT_VIDEO");
  });

  it("only offers formats the media pipeline can currently produce", () => {
    // With the video engine unavailable, the balancer must stay inside the
    // text-capable set rather than scheduling a video that cannot be rendered.
    const available: ContentFormat[] = ["TEXT_POST", "CAROUSEL", "ARTICLE", "INFOGRAPHIC"];
    for (let i = 0; i < 10; i++) {
      expect(available).toContain(nextFormat({ TEXT_POST: i }, available));
    }
  });

  it("throws when no format is available rather than silently picking one", () => {
    expect(() => nextFormat({}, [])).toThrow(/no content formats available/);
  });
});
