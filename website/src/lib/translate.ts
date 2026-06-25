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
