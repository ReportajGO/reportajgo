import { GoogleGenAI } from "@google/genai";
import { env } from "../config/env.js";
import { getRuntimeConfig } from "../config/settingsStore.js";
import { logger } from "../config/logger.js";

/** Current model from runtime settings (falls back to the env default). */
async function model(): Promise<string> {
  return (await getRuntimeConfig()).geminiModel;
}

const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

const log = logger.child({ module: "gemini" });

const MAX_RETRIES = 6;
const BASE_DELAY_MS = 1500;
const MAX_DELAY_MS = 30_000;
// Transient statuses worth retrying (overload / rate limit / gateway).
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function statusOf(err: unknown): number | undefined {
  if (typeof err === "object" && err !== null && "status" in err) {
    const s = (err as { status?: unknown }).status;
    if (typeof s === "number") return s;
  }
  return undefined;
}

/**
 * Run any Gemini call with exponential backoff on transient errors
 * (429/5xx / "high demand" 503). Reused by both text and image generation.
 */
export async function withGeminiRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = statusOf(err);
      if (attempt === MAX_RETRIES || (status !== undefined && !RETRYABLE.has(status))) {
        throw err;
      }
      const delay = Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);
      log.warn({ status, attempt: attempt + 1, delay }, "gemini transient error; retrying");
      await sleep(delay);
    }
  }
  throw lastErr;
}

/** Call generateContent with exponential backoff on transient errors. */
async function callModel(
  params: Parameters<typeof ai.models.generateContent>[0],
): ReturnType<typeof ai.models.generateContent> {
  return withGeminiRetry(() => ai.models.generateContent(params));
}

export interface GroundedResult<T> {
  data: T;
  /** Source URIs surfaced by Google Search grounding, for attribution. */
  sources: { title?: string; uri: string }[];
}

/**
 * Run a prompt with Google Search grounding and parse a JSON array/object
 * out of the response. Grounding and strict JSON mode cannot be combined,
 * so we instruct the model to emit JSON and extract it defensively.
 */
export async function groundedJson<T>(prompt: string): Promise<GroundedResult<T>> {
  const response = await callModel({
    model: await model(),
    contents: prompt,
    config: {
      tools: [{ googleSearch: {} }],
      temperature: 0.4,
    },
  });

  const text = response.text ?? "";
  const data = extractJson<T>(text);

  const chunks =
    response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
  const sources = chunks
    .map((c) => c.web)
    .filter((w): w is { uri: string; title?: string } => Boolean(w?.uri))
    .map((w) => ({ uri: w.uri, title: w.title }));

  log.debug({ sourceCount: sources.length }, "grounded response parsed");
  return { data, sources };
}

/** Plain (ungrounded) JSON generation — used for scoring/classification. */
export async function generateJson<T>(prompt: string, temperature = 0.2): Promise<T> {
  const response = await callModel({
    model: await model(),
    contents: prompt,
    config: { temperature, responseMimeType: "application/json" },
  });
  return extractJson<T>(response.text ?? "");
}

/** Free-form text generation (used for copywriting). */
export async function generateText(prompt: string, temperature = 0.7): Promise<string> {
  const response = await callModel({
    model: await model(),
    contents: prompt,
    config: { temperature },
  });
  return (response.text ?? "").trim();
}

/** Extract a JSON value from a model response that may wrap it in prose/fences. */
export function extractJson<T>(text: string): T {
  const trimmed = text.trim();
  // Strip ```json fences if present.
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1]! : trimmed;

  try {
    return JSON.parse(candidate) as T;
  } catch {
    // Fall back to the first {...} or [...] span.
    const start = candidate.search(/[[{]/);
    const end = Math.max(candidate.lastIndexOf("]"), candidate.lastIndexOf("}"));
    if (start !== -1 && end > start) {
      return JSON.parse(candidate.slice(start, end + 1)) as T;
    }
    throw new Error(`Failed to parse JSON from model response: ${text.slice(0, 200)}`);
  }
}
