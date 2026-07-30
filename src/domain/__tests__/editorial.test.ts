import { describe, expect, it } from "vitest";
import {
  APPROVAL_TIERS,
  BANNED_CATEGORIES,
  YELLOW_ZONE,
  maxTier,
  screenCompliance,
  tierSpec,
} from "../editorial.js";

describe("screenCompliance — prohibited categories", () => {
  it("flags political content as RED", () => {
    const result = screenCompliance("National election results announced after the ballot count");
    expect(result.zone).toBe("RED");
    expect(result.bannedCategories).toContain("POLITICS");
  });

  it("flags armed conflict as RED", () => {
    const result = screenCompliance("Missile strike reported near the border");
    expect(result.zone).toBe("RED");
    expect(result.bannedCategories).toContain("CONFLICT");
  });

  it("flags crime as RED", () => {
    const result = screenCompliance("Two suspects arrested over a large fraud charges case");
    expect(result.zone).toBe("RED");
    expect(result.bannedCategories).toContain("CRIME");
  });

  it("flags disaster and casualty content as RED", () => {
    const result = screenCompliance("Earthquake leaves rising death toll in coastal region");
    expect(result.zone).toBe("RED");
    expect(result.bannedCategories).toContain("DISASTER");
  });

  it("flags manufactured superlatives as manipulation", () => {
    const result = screenCompliance("The world's only guaranteed returns investment scheme");
    expect(result.zone).toBe("RED");
    expect(result.bannedCategories).toContain("MANIPULATION");
  });

  it("detects prohibited terms in Uzbek and Russian, not only English", () => {
    expect(screenCompliance("Saylov natijalari e'lon qilindi").zone).toBe("RED");
    expect(screenCompliance("Задержан подозреваемый").zone).toBe("RED");
  });
});

describe("screenCompliance — precision", () => {
  it("passes ordinary constructive business copy", () => {
    const result = screenCompliance(
      "Uzbek agritech startup cuts irrigation water use by 40% in a pilot with three farms",
    );
    expect(result.zone).toBe("GREEN");
    expect(result.bannedCategories).toEqual([]);
  });

  it("does not fire on words that merely CONTAIN a banned term", () => {
    // "war" must not match "warehouse"/"forward"; "crash" must not match a
    // "crash course"; these are the false positives that would silently gut the
    // feed if the screen matched on substrings.
    const result = screenCompliance(
      "New logistics warehouse moves forward, bringing a crash course in export skills",
    );
    expect(result.zone).toBe("GREEN");
  });

  it("passes a science story that names a research result", () => {
    const result = screenCompliance(
      "University laboratory publishes a new catalyst that halves hydrogen production cost",
    );
    expect(result.zone).toBe("GREEN");
  });

  // Regression: English business writing is full of martial and catastrophic
  // idiom. A keyword match is TERMINAL (the LLM is never consulted), so each of
  // these once silently deleted a legitimate story from the feed — and they sit
  // in the ECONOMY/STARTUP/PEOPLE registers that are 55% of the target mix.
  it.each([
    ["price war", "Local supermarkets locked in a price war over grocery staples, boosting margins"],
    ["talent war", "Coffee chain wins the barista talent war with a new training academy"],
    ["shooting for the stars", "Young founder says she is shooting for the stars with her new fintech app"],
    ["shooting a video", "Startup team shooting a new product demo video for investors"],
    ["blasts past", "Regional airline blasts past its quarterly growth target"],
    ["demand explosion", "Demand explosion pushes solar panel exports to a record high"],
    ["spread like wildfire", "New training programme spread like wildfire among young engineers"],
    ["killed its burn rate", "Startup killed its burn rate and reached profitability"],
    ["brutal competition", "Exporters face brutal competition but grew margins by 12%"],
    ["bidding war", "Investors enter a bidding war for the agritech firm's Series B"],
  ])("does not reject constructive copy containing the idiom %s", (_idiom, headline) => {
    expect(screenCompliance(headline).zone).toBe("GREEN");
  });

  it("classifies a vaccine story as YELLOW, not as a political candidate", () => {
    // "candidate" used to match the POLITICS list and drop this outright. It is
    // now correctly medical yellow-zone material: publishable with the
    // no-treatment-advice handling and tier C sign-off, NOT rejected.
    const result = screenCompliance(
      "Vaccine candidate developed by a university lab enters partnership talks",
    );
    expect(result.zone).toBe("YELLOW");
    expect(result.bannedCategories).toEqual([]);
    expect(result.yellowRules).toContain("medical");
  });

  // The tightened lists must still catch the genuine article.
  it.each([
    ["civil war", "Civil war displaces thousands in the region"],
    ["missile strike", "Missile strike destroys a power station"],
    ["mass shooting", "Mass shooting reported at a shopping centre"],
    ["death toll", "Death toll rises after the building collapse"],
    ["money laundering", "Bank executives charged with money laundering"],
    ["war crimes", "Tribunal opens a war crimes case"],
  ])("still rejects genuinely prohibited material containing %s", (_term, headline) => {
    expect(screenCompliance(headline).zone).toBe("RED");
  });
});

describe("screenCompliance — yellow zone", () => {
  it("escalates state decisions to YELLOW and tier C", () => {
    const result = screenCompliance("Government approved a new industrial park programme");
    expect(result.zone).toBe("YELLOW");
    expect(result.yellowRules).toContain("state-decision");
    expect(result.tier).toBe("C");
    expect(result.handling.join(" ")).toMatch(/economic or investment impact/i);
  });

  it("escalates medical topics to YELLOW with a no-treatment-advice instruction", () => {
    const result = screenCompliance("Clinical trial shows promise for a new therapy");
    expect(result.zone).toBe("YELLOW");
    expect(result.yellowRules).toContain("medical");
    expect(result.handling.join(" ")).toMatch(/never present as treatment advice/i);
  });

  it("escalates sponsored material so it gets a partnership label", () => {
    const result = screenCompliance("Sponsored: how this fund invests in regional logistics");
    expect(result.zone).toBe("YELLOW");
    expect(result.yellowRules).toContain("commercial-interest");
  });

  it("treats a blocking yellow-zone rule as RED, not merely escalated", () => {
    const result = screenCompliance("A contested heritage claim revisited");
    expect(result.zone).toBe("RED");
  });

  it("lets a prohibited category win over a yellow-zone match", () => {
    // Both a state decision AND crime — the prohibition must decide.
    const result = screenCompliance("Government approved the decree after a murder investigation");
    expect(result.zone).toBe("RED");
    expect(result.bannedCategories).toContain("CRIME");
  });
});

describe("approval tiers", () => {
  it("orders tiers C > B > A", () => {
    expect(maxTier("A", "B")).toBe("B");
    expect(maxTier("B", "C")).toBe("C");
    expect(maxTier("C", "A")).toBe("C");
    expect(maxTier("A", "A")).toBe("A");
  });

  it("defines all three levels with their required approvers", () => {
    expect(APPROVAL_TIERS).toHaveLength(3);
    expect(tierSpec("A").approvers).toContain("native-editor");
    expect(tierSpec("B").approvers).toContain("fact-checker");
    expect(tierSpec("C").approvers).toContain("compliance");
  });

  it("throws on an unknown tier rather than defaulting to a permissive one", () => {
    expect(() => tierSpec("D" as never)).toThrow(/unknown approval tier/);
  });
});

describe("charter integrity", () => {
  it("covers every prohibited category named in the concept document", () => {
    const ids = BANNED_CATEGORIES.map((c) => c.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "POLITICS",
        "GEOPOLITICS",
        "CONFLICT",
        "CRIME",
        "DISASTER",
        "VIOLENCE",
        "SCANDAL",
        "MANIPULATION",
        "DIVISIVE_HISTORY",
      ]),
    );
  });

  it("gives every yellow-zone rule an explicit handling instruction", () => {
    for (const rule of YELLOW_ZONE) {
      expect(rule.handling.trim().length).toBeGreaterThan(0);
    }
  });

  it("gives every banned category at least one detection keyword", () => {
    for (const cat of BANNED_CATEGORIES) {
      expect(cat.keywords.length).toBeGreaterThan(0);
    }
  });
});
