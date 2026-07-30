// The publication language — one per deployment, chosen by the operator.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY THIS EXISTS
//
// The 21-market matrix (src/domain/markets.ts) gives every market its own
// `primaryLanguage`, and the copy stage briefly read the post language straight
// off it. That produced Japanese, Korean, Malay, Chinese, Turkish and Arabic
// posts while the operator had selected Uzbek in the dashboard.
//
// A market's `primaryLanguage` describes who a story is FOR. It is not, and must
// never become, the language a post is WRITTEN in — that is an operator setting
// (`contentLanguages`, editable from the dashboard and the Telegram panel), and
// it is authoritative. Publishing is single-channel anyway (one Telegram
// channel, one Instagram account, one website), so there is exactly one
// audience and exactly one language to serve it in.
//
// Markets therefore contribute framing and relevance only. Language comes from
// here, and from nowhere else.
// ─────────────────────────────────────────────────────────────────────────────

/** Used only when the config somehow carries no usable language at all. */
const FALLBACK_LANGUAGE = "en";

/** Human-readable names for the language codes the pipeline can publish in. */
const LANGUAGE_NAMES: Record<string, string> = {
  uz: "Uzbek",
  ru: "Russian",
  en: "English",
  ja: "Japanese",
  ko: "Korean",
  ms: "Malay",
  "zh-hans": "Simplified Chinese",
  "zh-hant": "Traditional Chinese",
  tr: "Turkish",
  de: "German",
  fr: "French",
  sv: "Swedish",
  ar: "Arabic",
  es: "Spanish",
  "pt-br": "Brazilian Portuguese",
};

/** English name of a language code, or the code itself when unknown. */
export function languageName(language: string): string {
  return LANGUAGE_NAMES[language.trim().toLowerCase()] ?? language.trim();
}

/**
 * The single language every generated post is written in.
 *
 * The dashboard documents the contract as "first selected language is the
 * primary post language", so the head of `contentLanguages` wins. Blank entries
 * are ignored rather than trusted, since an empty language in a prompt reads as
 * "any language" to the model — the exact failure this module exists to stop.
 */
export function resolvePublicationLanguage(contentLanguages: readonly string[]): string {
  const selected = contentLanguages.map((l) => l.trim()).filter(Boolean);
  return selected[0] ?? FALLBACK_LANGUAGE;
}

/**
 * Whether this language uses right-to-left layout, which drives card rendering
 * and subtitle alignment (TZ §11, §12).
 */
export function isRtlLanguage(language: string): boolean {
  return /^(ar|he|fa|ur)\b/i.test(language.trim());
}

/**
 * The hard language instruction shared by every generation prompt.
 *
 * It is phrased as an override because the same prompt also names a target
 * market and quotes that market's localisation note — without this block the
 * model reliably concludes it should answer in the market's own language.
 */
export function languageRulePromptBlock(language: string): string {
  const name = languageName(language);
  return [
    `OUTPUT LANGUAGE — ${name} ("${language}"). This rule overrides every other`,
    `instruction in this prompt:`,
    `- Write ALL generated text in ${name}, and in no other language.`,
    `- The language is fixed by the editorial configuration. It is NOT derived`,
    `  from the target market — never switch to the market's local language.`,
    `- Do not mix languages, and do not append a translation of any part.`,
    `- Proper nouns keep their original spelling; everything else is ${name}.`,
    isRtlLanguage(language)
      ? `- ${name} is right-to-left: use correct RTL punctuation and typography.`
      : null,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}
