/**
 * Translation engine for multilingual posts.
 *
 * One post is stored with translations for all three site languages so it can
 * appear on every locale in the reader's language. Provider chain:
 *   1. Gemini       — if GEMINI_API_KEY is set (best quality, incl. Uzbek)
 *   2. Claude API   — if ANTHROPIC_API_KEY is set
 *   3. Google (free, unofficial endpoint) — works with no key
 *   4. Identity     — copy the source text (post still shows everywhere)
 */
import { locales } from "@/i18n/routing";

export type Tr = { title: string; excerpt: string; body: string };
export type Translations = Record<string, Tr>;

const ALL = locales as readonly string[];

const LANG_NAME: Record<string, string> = {
  uz: "Uzbek (Latin script)",
  ru: "Russian",
  en: "English",
};

/** Pull a JSON object out of a model reply (handles ```json fences / prose). */
function extractJson(text: string): Tr {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("no JSON in model reply");
  const parsed = JSON.parse(text.slice(start, end + 1));
  return { title: parsed.title, excerpt: parsed.excerpt, body: parsed.body };
}

function buildPrompt(src: Tr, sl: string, tl: string): string {
  return (
    `Translate this news article from ${LANG_NAME[sl] ?? sl} to ${LANG_NAME[tl] ?? tl}. ` +
    `Preserve meaning, journalistic tone and paragraph breaks (\\n\\n). ` +
    `Return ONLY a JSON object: {"title":"…","excerpt":"…","body":"…"}.\n\n` +
    JSON.stringify(src)
  );
}

// ── Google (keyless) ─────────────────────────────────────────────────────────
async function googleChunk(text: string, sl: string, tl: string): Promise<string> {
  const url =
    `https://translate.googleapis.com/translate_a/single?client=gtx` +
    `&sl=${sl}&tl=${tl}&dt=t&q=${encodeURIComponent(text)}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`google ${r.status}`);
  const data = await r.json();
  return (data?.[0] ?? []).map((seg: unknown[]) => seg[0]).join("");
}

async function googleText(text: string, sl: string, tl: string): Promise<string> {
  if (!text.trim()) return text;
  // Translate paragraph-by-paragraph to respect URL length and keep structure.
  const paras = text.split(/\n\n+/);
  const out: string[] = [];
  for (const p of paras) {
    if (p.length <= 4500) {
      out.push(await googleChunk(p, sl, tl));
    } else {
      // very long paragraph → split by single newlines / sentences
      const parts = p.split(/\n/);
      const sub: string[] = [];
      for (const part of parts) sub.push(await googleChunk(part, sl, tl));
      out.push(sub.join("\n"));
    }
  }
  return out.join("\n\n");
}

async function googleTr(src: Tr, sl: string, tl: string): Promise<Tr> {
  const [title, excerpt, body] = await Promise.all([
    googleText(src.title, sl, tl),
    googleText(src.excerpt, sl, tl),
    googleText(src.body, sl, tl),
  ]);
  return { title, excerpt, body };
}

// ── Gemini (optional, env-gated) ─────────────────────────────────────────────
async function geminiCall(src: Tr, sl: string, tl: string, model: string): Promise<Tr> {
  const key = process.env.GEMINI_API_KEY!;
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: buildPrompt(src, sl, tl) }] }],
      generationConfig: { temperature: 0.2 },
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`gemini ${res.status}`);
  const data = await res.json();
  const text: string = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  return extractJson(text);
}

async function geminiTr(src: Tr, sl: string, tl: string): Promise<Tr> {
  const primary = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  // On overload (503) retry once, then fall back to the lighter model.
  try {
    return await geminiCall(src, sl, tl, primary);
  } catch (e) {
    console.error(`[translate] Gemini ${primary} failed (${sl}->${tl}), retrying lite:`, e);
    await new Promise((r) => setTimeout(r, 1200));
    return await geminiCall(src, sl, tl, "gemini-2.5-flash-lite");
  }
}

// ── Claude (optional, env-gated) ─────────────────────────────────────────────
async function claudeTr(src: Tr, sl: string, tl: string): Promise<Tr> {
  const key = process.env.ANTHROPIC_API_KEY!;
  const model = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001";
  const langName: Record<string, string> = { uz: "Uzbek", ru: "Russian", en: "English" };

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content:
            `Translate this news article from ${langName[sl] ?? sl} to ${langName[tl] ?? tl}. ` +
            `Keep the meaning, tone and paragraph breaks. Return ONLY JSON: ` +
            `{"title":"…","excerpt":"…","body":"…"}.\n\n` +
            JSON.stringify(src),
        },
      ],
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`claude ${res.status}`);
  const data = await res.json();
  const text: string = data?.content?.[0]?.text ?? "";
  const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  const parsed = JSON.parse(json);
  return { title: parsed.title, excerpt: parsed.excerpt, body: parsed.body };
}

async function translateOne(src: Tr, sl: string, tl: string): Promise<Tr> {
  if (process.env.GEMINI_API_KEY) {
    try {
      return await geminiTr(src, sl, tl);
    } catch (e) {
      console.error(`[translate] Gemini failed (${sl}->${tl}), trying next:`, e);
    }
  }
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      return await claudeTr(src, sl, tl);
    } catch (e) {
      console.error(`[translate] Claude failed (${sl}->${tl}), trying Google:`, e);
    }
  }
  try {
    return await googleTr(src, sl, tl);
  } catch (e) {
    console.error(`[translate] Google failed (${sl}->${tl}), using source as-is:`, e);
    return { ...src }; // identity fallback — post still appears, untranslated
  }
}

// ── Professional theme/section labels ────────────────────────────────────────
type Labels = { uz: string; ru: string; en: string };

const LABEL_PROMPT = (raw: string) =>
  `You are naming a section on a professional news website. An editor typed a ` +
  `raw topic that may be sloppy, lowercase, mistyped, abbreviated, or in any ` +
  `language. Turn it into a clean, professional news-section title — concise ` +
  `(1–3 words), Title Case, no quotes, no trailing punctuation, no emoji — in ` +
  `three languages: Uzbek (Latin script), Russian, and English. Keep proper ` +
  `nouns (countries, leagues, brands) correct. ` +
  `Return ONLY JSON: {"uz":"…","ru":"…","en":"…"}. Raw topic: ${JSON.stringify(raw)}`;

// Transient statuses worth retrying (Gemini "high demand" 503, rate limit, gateways).
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function geminiLabels(raw: string, model: string): Promise<Labels> {
  const key = process.env.GEMINI_API_KEY!;
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

  // Retry transient 5xx/429 a few times — these blips are common and usually
  // clear within a second or two, so they shouldn't surface as a hard error.
  let lastStatus = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: LABEL_PROMPT(raw) }] }],
        generationConfig: { temperature: 0.2 },
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (res.ok) {
      const data = await res.json();
      const text: string = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
      const p = JSON.parse(json);
      const clean = (s: unknown) => String(s ?? "").trim();
      return { uz: clean(p.uz), ru: clean(p.ru), en: clean(p.en) };
    }
    lastStatus = res.status;
    if (!RETRYABLE_STATUS.has(res.status)) break;
    await sleep(800 * (attempt + 1));
  }
  throw new Error(`gemini ${lastStatus}`);
}

/**
 * Produce a professional, localized section title (UZ/RU/EN) from whatever the
 * operator typed as a topic filter. Prefers Gemini (cleans + translates in one
 * shot); falls back to literal translation, then to the raw name as-is.
 */
export async function themeLabels(
  raw: string,
  sourceLang: string,
): Promise<Record<string, string>> {
  const name = raw.trim();
  if (process.env.GEMINI_API_KEY) {
    const primary = process.env.GEMINI_MODEL || "gemini-2.5-flash";
    for (const model of [primary, "gemini-2.5-flash-lite"]) {
      try {
        const g = await geminiLabels(name, model);
        if (g.uz && g.ru && g.en) return { uz: g.uz, ru: g.ru, en: g.en };
      } catch (e) {
        // Transient (e.g. Gemini 503 high-demand) — we fall back to the next
        // model / literal translation, so this is a warning, not an error.
        console.warn(`[translate] theme labels via ${model} unavailable, falling back:`, e instanceof Error ? e.message : e);
      }
    }
  }
  // Fallback: literal machine translation, then identity.
  try {
    return await translateText(name, sourceLang);
  } catch {
    const out: Record<string, string> = {};
    for (const loc of ALL) out[loc] = name;
    return out;
  }
}

/**
 * Translate a SHORT label (e.g. a theme/section name) into every site language.
 * Uses literal machine translation (keyless Google) rather than the article
 * prompt — short inputs make the LLM "translate an article" prompt hallucinate a
 * whole story, so we keep labels literal. Identity fallback on failure.
 */
export async function translateText(
  text: string,
  sourceLang: string,
): Promise<Record<string, string>> {
  const out: Record<string, string> = { [sourceLang]: text };
  const targets = ALL.filter((l) => l !== sourceLang);
  const results = await Promise.all(
    targets.map(async (t) => {
      try {
        const r = (await googleText(text, sourceLang, t)).trim();
        return r || text;
      } catch (e) {
        console.error(`[translate] label ${sourceLang}->${t} failed:`, e);
        return text; // identity fallback — show the source label
      }
    }),
  );
  targets.forEach((t, i) => (out[t] = results[i]));
  return out;
}

/**
 * Produce translations for all site languages from a single source.
 * The source language is stored verbatim; the others are translated.
 */
export async function translateAll(
  src: Tr,
  sourceLang: string,
): Promise<Translations> {
  const targets = ALL.filter((l) => l !== sourceLang);
  const results = await Promise.all(targets.map((t) => translateOne(src, sourceLang, t)));

  const out: Translations = { [sourceLang]: { ...src } };
  targets.forEach((t, i) => (out[t] = results[i]));
  return out;
}
