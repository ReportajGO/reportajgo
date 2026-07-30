import { describe, expect, it } from "vitest";
import {
  isRtlLanguage,
  languageName,
  languageRulePromptBlock,
  resolvePublicationLanguage,
} from "../language.js";
import { MARKETS, marketOf } from "../markets.js";

describe("resolvePublicationLanguage", () => {
  it("uses the first selected language, as the dashboard promises", () => {
    // Arrange
    const contentLanguages = ["uz", "ru", "en"];

    // Act
    const language = resolvePublicationLanguage(contentLanguages);

    // Assert
    expect(language).toBe("uz");
  });

  it("returns the only language when the operator selected exactly one", () => {
    expect(resolvePublicationLanguage(["uz"])).toBe("uz");
  });

  it("ignores blank entries rather than emitting an empty language", () => {
    // An empty language in a prompt reads as "any language" to the model — the
    // exact failure this module exists to prevent.
    expect(resolvePublicationLanguage(["", "  ", "ru"])).toBe("ru");
  });

  it("trims surrounding whitespace", () => {
    expect(resolvePublicationLanguage([" en "])).toBe("en");
  });

  it("falls back to English when nothing usable is configured", () => {
    expect(resolvePublicationLanguage([])).toBe("en");
    expect(resolvePublicationLanguage(["   "])).toBe("en");
  });

  it("never returns a market's primary language just because markets are active", () => {
    // The regression: posts came out in ja/ko/ms/zh/tr/ar while the operator had
    // selected Uzbek, because copy generation read market.primaryLanguage.
    const pilotLanguages = MARKETS.filter((m) => m.phase === 1).map((m) => m.primaryLanguage);

    const language = resolvePublicationLanguage(["uz"]);

    expect(pilotLanguages).toContain(marketOf("JP").primaryLanguage);
    expect(pilotLanguages).not.toContain(language);
  });
});

describe("languageRulePromptBlock", () => {
  it("names the language and forbids following the market instead", () => {
    // Act
    const block = languageRulePromptBlock("uz");

    // Assert
    expect(block).toContain("Uzbek");
    expect(block).toContain('"uz"');
    expect(block).toContain("overrides every other");
    expect(block).toMatch(/NOT derived/);
    expect(block).toMatch(/never switch to the market's local language/i);
  });

  it("adds the RTL note only for right-to-left languages", () => {
    expect(languageRulePromptBlock("ar")).toMatch(/right-to-left/);
    expect(languageRulePromptBlock("uz")).not.toMatch(/right-to-left/);
  });

  it("still produces a usable rule for a language it has no name for", () => {
    const block = languageRulePromptBlock("kk");
    expect(block).toContain("kk");
  });
});

describe("languageName", () => {
  it("maps the codes the pipeline publishes in", () => {
    expect(languageName("uz")).toBe("Uzbek");
    expect(languageName("ZH-Hans")).toBe("Simplified Chinese");
    expect(languageName("pt-BR")).toBe("Brazilian Portuguese");
  });

  it("falls back to the raw code when unknown", () => {
    expect(languageName("kk")).toBe("kk");
  });
});

describe("isRtlLanguage", () => {
  it("detects right-to-left languages", () => {
    expect(isRtlLanguage("ar")).toBe(true);
    expect(isRtlLanguage("fa")).toBe(true);
  });

  it("treats left-to-right languages as such", () => {
    expect(isRtlLanguage("uz")).toBe(false);
    expect(isRtlLanguage("ja")).toBe(false);
  });
});
