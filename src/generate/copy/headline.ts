import { generateText } from "../../research/gemini.js";

const LANGUAGE_NAMES: Record<string, string> = {
  uz: "Uzbek",
  ru: "Russian",
  en: "English",
};

// Reference headlines distilled from real Uzbek outlets (Kun.uz / Gazeta.uz /
// Daryo.uz) — they define the target register and the working patterns.
const STYLE_EXAMPLES = [
  // declarative, place/subject first, verb last
  "Toshkentda sun'iy intellekt va raqamli hukumat sohasida xalqaro trening o'tkazildi",
  "Shavkat Mirziyoyev Toni Bler bilan hamkorlik istiqbollarini muhokama qildi",
  "Afg'onistondagi zilzila O'zbekistonning deyarli barcha hududida sezildi",
  // statement/claim with source attribution after an em-dash
  "Banklarda xorijiy valyuta oldi-sotdisi keskin oshdi — Markaziy bank",
  // direct quote, then speaker + context
  "«O'zbekiston doim hujumkor jamoa bo'lishga intiladi» — Kannavaro Kongo DR bilan o'yin oldidan",
  // colon: a sharp lead + supporting detail
  "Maosh 2 ming yevrogacha: o'zbekistonliklar Italiyaga qurilish ishlariga taklif qilinmoqda",
  // concrete numbers
  "Venesuelada zilzilalar oqibatida halok bo'lganlar soni 235 kishidan oshdi",
  // planned/ongoing action
  "O'zbekistonda 16 yoshgacha bolalarga ijtimoiy tarmoqlardan foydalanish cheklanishi mumkin",
];

interface NewsForHeadline {
  title: string;
  summary: string;
}

/**
 * Generate a professional news headline in the post language — the same text
 * used on the card image, the dashboard, the published title and the caption.
 *
 * Register and patterns are modelled on real Uzbek outlets (Kun.uz, Gazeta.uz,
 * Daryo.uz): a native, verb-final statement led by who/where + the concrete
 * outcome, with source attribution ("— Manba"), quote («…» — Speaker), or a
 * "lead: detail" colon when it sharpens the headline.
 */
export async function generateCardHeadline(
  news: NewsForHeadline,
  language: string,
): Promise<string> {
  const langName = LANGUAGE_NAMES[language] ?? language;
  const prompt = [
    `You are a senior editor at a top Uzbek news outlet (think Kun.uz / Gazeta.uz`,
    `/ Daryo.uz). Write ONE professional headline in ${langName} for the story below.`,
    ``,
    `WRITE LIKE A NATIVE EDITOR — not a translation:`,
    `- Natural, fluent ${langName}. Re-phrase the story idiomatically; never`,
    `  translate the English title word-for-word.`,
    `- For Uzbek: correct grammar and word order (verb at the end), correct`,
    `  orthography (o', g', '). It must read as if written by an Uzbek journalist.`,
    ``,
    `STRUCTURE:`,
    `- Lead with WHO or WHERE (person, country, city, organization), end with the`,
    `  concrete action/outcome. Keep specific names, numbers and places.`,
    `- Tense: completed events → past (e.g. "o'tkazildi", "muhokama qildi");`,
    `  planned/ongoing → "-moqda" / "-adi" / "mumkin" (e.g. "taklif qilinmoqda").`,
    `- Pick the ONE pattern that fits the story:`,
    `  • Declarative — subject/place + what happened (most common).`,
    `  • Attribution — "[statement] — Manba/Shaxs" when it's a claim, report or`,
    `    forecast by someone/an outlet (e.g. "… — Markaziy bank", "… — Bloomberg").`,
    `  • Quote — «exact quote» — Speaker + context, ONLY if there is a real quote.`,
    `  • Lead + detail — "Asosiy lead: qisqa tafsilot" when a colon sharpens it.`,
    ``,
    `BANNED: clickbait, emoji, hashtags, the source name as a label prefix, a`,
    `period at the end, and quotation marks around the whole line.`,
    `LENGTH: about 55–100 characters. Never cut a word.`,
    ``,
    `STYLE EXAMPLES (match this exact tone and quality):`,
    ...STYLE_EXAMPLES.map((e) => `- ${e}`),
    ``,
    `STORY:`,
    `Title: ${news.title}`,
    `Summary: ${news.summary}`,
    ``,
    `Return ONLY the headline text.`,
  ].join("\n");

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
