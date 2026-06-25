import { generateText } from "../../research/gemini.js";

const LANGUAGE_NAMES: Record<string, string> = {
  uz: "Uzbek",
  ru: "Russian",
  en: "English",
};

interface NewsForHeadline {
  title: string;
  summary: string;
}

/**
 * Generate a short, punchy news-card headline in the post language — a strong
 * factual statement, optionally with a colon and a supporting detail, e.g.
 * "O'zbekiston importi 27% ga oshdi: Xitoy va Rossiya yetakchilik qilmoqda".
 * This is the text overlaid on the branded card (not the full post body).
 */
export async function generateCardHeadline(
  news: NewsForHeadline,
  language: string,
): Promise<string> {
  const langName = LANGUAGE_NAMES[language] ?? language;
  const prompt = [
    `You write punchy news-card headlines for a social-media news channel.`,
    `Write ONE headline in ${langName} that captures the core of the news below.`,
    `Style: a strong, specific main statement (include the key number/fact when there is one),`,
    `optionally followed by a colon and a short supporting detail.`,
    `Example style: "O'zbekiston importi 27% ga oshdi: Xitoy va Rossiya yetakchilik qilmoqda".`,
    `Keep it under ~100 characters. No quotes, no hashtags, no emoji, no source name.`,
    ``,
    `Title: ${news.title}`,
    `Summary: ${news.summary}`,
    ``,
    `Return ONLY the headline text.`,
  ].join("\n");

  const text = await generateText(prompt, 0.5);
  return text
    .trim()
    .replace(/^["'«»]+|["'«»]+$/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 160);
}
