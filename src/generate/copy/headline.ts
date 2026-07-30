// Headline generation, per market and per language.
//
// Source of truth: TZ §11 (tarjima va lokalizatsiya), §12 (thumbnail talablari),
// §6 (no clickbait / no alarm).
//
// Previously this module wrote every headline as an Uzbek news editor, using
// Kun.uz / Gazeta.uz register and Uzbek verb-final grammar. That is exactly
// right for the domestic channel and exactly wrong for the other 20 markets: the
// network's core localisation rule is that a headline is re-created for the local
// audience, never translated into it (TZ §11).
//
// So the Uzbek style guide is retained as ONE language profile among several,
// and the market's own framing note is injected alongside it.

import { findMarket } from "../../domain/markets.js";
import { generateText } from "../../research/gemini.js";

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

function languageName(language: string): string {
  return LANGUAGE_NAMES[language.toLowerCase()] ?? language;
}

/**
 * Language-specific headline craft notes. Only languages with a genuinely
 * distinct convention are listed; everything else gets the shared rules plus its
 * market's framing note, which is the more useful signal anyway.
 */
const LANGUAGE_NOTES: Record<string, string[]> = {
  uz: [
    "Correct Uzbek word order (verb at the end) and orthography (o', g', ').",
    "Read as if written by an Uzbek journalist, never as a translation.",
    "Completed events → past tense (\"o'tkazildi\", \"muhokama qildi\");",
    "planned or ongoing → \"-moqda\" / \"-adi\" / \"mumkin\".",
  ],
  ja: [
    "Concise and understated. Japanese headlines carry weight through precision,",
    "not emphasis. No exclamation, no hype adjectives.",
  ],
  ko: [
    "Keyword-led so it surfaces in Naver search. Front-load the searchable term.",
  ],
  de: [
    "Precise and quantified. German readers reject unsupported superlatives —",
    "lead with the concrete figure or the named institution.",
  ],
  ar: [
    "Formal Modern Standard Arabic. Right-to-left layout.",
    "Respectful register; no sensational phrasing.",
  ],
  "zh-hans": ["Simplified characters only. Compact, information-dense phrasing."],
  "zh-hant": ["Traditional characters only. Never reuse a simplified-character version."],
};

// Reference headlines distilled from real Uzbek outlets (Kun.uz / Gazeta.uz /
// Daryo.uz) — they define the target register for the Uzbek language profile.
// Note these are STRUCTURAL references: several describe earthquakes and
// casualties, which the network no longer publishes (TZ §6). They are here to
// show sentence shape, not to suggest subject matter.
const UZ_STYLE_EXAMPLES = [
  "Toshkentda sun'iy intellekt va raqamli hukumat sohasida xalqaro trening o'tkazildi",
  "Banklarda xorijiy valyuta oldi-sotdisi keskin oshdi — Markaziy bank",
  "Maosh 2 ming yevrogacha: o'zbekistonliklar Italiyaga qurilish ishlariga taklif qilinmoqda",
  "O'zbekistonda yashil energetika loyihalariga investitsiyalar hajmi ikki barobar oshdi",
];

interface NewsForHeadline {
  title: string;
  summary: string;
  constructiveAngle?: string | null;
}

export interface HeadlineOptions {
  language: string;
  /** Target market code, so the headline carries local framing (TZ §8). */
  market?: string | null;
}

/**
 * Generate a professional headline in the target market's language — the same
 * text used on the card image, the dashboard, the published title and the
 * caption.
 *
 * The headline is written for the local audience by a native-editor persona, and
 * is constrained by the network's standing rules: no clickbait, no alarm, no
 * sensationalism (TZ §6, §12).
 */
export async function generateCardHeadline(
  news: NewsForHeadline,
  options: HeadlineOptions | string,
): Promise<string> {
  // Accept a bare language string for backward compatibility with callers that
  // predate market-aware headlines.
  const opts: HeadlineOptions =
    typeof options === "string" ? { language: options } : options;
  const langKey = opts.language.toLowerCase();
  const langName = languageName(opts.language);
  const market = opts.market ? findMarket(opts.market) : undefined;
  const langNotes = LANGUAGE_NOTES[langKey] ?? [];

  const prompt = [
    `You are a senior native editor at Reportage GO, an international constructive`,
    `media network. Write ONE professional headline in ${langName} for the story below.`,
    market ? `` : null,
    market ? `TARGET AUDIENCE: ${market.nameEn}` : null,
    market ? `Local framing: ${market.localizationNote}` : null,
    ``,
    `WRITE LIKE A NATIVE EDITOR — not a translation:`,
    `- Natural, fluent ${langName}. Re-phrase the story idiomatically for this`,
    `  audience; never translate the source title word-for-word.`,
    ...langNotes.map((n) => `- ${n}`),
    ``,
    `STRUCTURE:`,
    `- Lead with WHO or WHERE (person, country, city, organization), end with the`,
    `  concrete action or outcome. Keep specific names, numbers and places.`,
    `- Where the story has a clear result or opportunity, put THAT in the headline.`,
    `- Pick the ONE pattern that fits:`,
    `  • Declarative — subject/place + what happened (most common).`,
    `  • Attribution — "[statement] — Source" for a claim, report or forecast.`,
    `  • Quote — «exact quote» — Speaker, ONLY if there is a real quote.`,
    `  • Lead + detail — "Main lead: short detail" when a colon sharpens it.`,
    ``,
    `BANNED (editorial policy, not preference):`,
    `- Clickbait, alarm, sensationalism, or manufactured urgency.`,
    `- Unverified superlatives ("world's only", "unprecedented").`,
    `- Emoji, hashtags, a source-name prefix label, a trailing period, and`,
    `  quotation marks around the whole line.`,
    `LENGTH: about 55-100 characters. Never cut a word.`,
    ``,
    ...(langKey === "uz"
      ? [
          `STYLE EXAMPLES (match this tone and quality):`,
          ...UZ_STYLE_EXAMPLES.map((e) => `- ${e}`),
          ``,
        ]
      : []),
    `STORY:`,
    `Title: ${news.title}`,
    `Summary: ${news.summary}`,
    news.constructiveAngle ? `Constructive angle: ${news.constructiveAngle}` : null,
    ``,
    `Return ONLY the headline text.`,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");

  const text = await generateText(prompt, 0.5);
  let headline = text.trim().replace(/\s+/g, " ");
  // Only unwrap quotes the model put around the ENTIRE line — keep intentional
  // inner quotes (the «quote» — Speaker pattern ends with a word, not a quote).
  if (/^["'«»“”].*["'«»“”]$/.test(headline)) {
    headline = headline.replace(/^["'«»“”]+/, "").replace(/["'«»“”]+$/, "").trim();
  }
  headline = headline.replace(/[.\s]+$/, ""); // drop any trailing period/space
  return headline.slice(0, 160);
}
