/**
 * Editors often prefix headlines with a flag/emoji (e.g. "🇩🇪 ТРАНСПОРТ: …").
 * In a big serif headline that emoji scales with the font and dominates the
 * line, so we split it off to render it at a tamer size.
 */
export function splitLeadingEmoji(title: string): {
  emoji: string;
  text: string;
} {
  const m = title.match(
    /^([\p{Regional_Indicator}\p{Extended_Pictographic}️‍]+)\s*/u,
  );
  if (!m) return { emoji: "", text: title };
  return { emoji: m[1], text: title.slice(m[0].length) };
}
