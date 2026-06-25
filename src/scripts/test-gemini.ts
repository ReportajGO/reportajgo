// Smoke test: confirms the Gemini key works and grounding returns sources.
// Usage: npx tsx src/scripts/test-gemini.ts
import { GoogleGenAI } from "@google/genai";
import { env } from "../config/env.js";

async function main() {
  const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  console.log(`Model: ${env.GEMINI_MODEL}`);
  console.log(`Key prefix: ${env.GEMINI_API_KEY.slice(0, 6)}…`);

  const res = await ai.models.generateContent({
    model: env.GEMINI_MODEL,
    contents: "Reply with exactly: OK",
  });
  console.log("Plain generation:", res.text);

  const grounded = await ai.models.generateContent({
    model: env.GEMINI_MODEL,
    contents: "What is one major news headline about Uzbekistan today? One sentence.",
    config: { tools: [{ googleSearch: {} }] },
  });
  console.log("Grounded generation:", grounded.text);
  const chunks =
    grounded.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
  console.log("Grounding sources:", chunks.length);
}

main().catch((err) => {
  console.error("GEMINI TEST FAILED:");
  console.error(err?.message ?? err);
  process.exitCode = 1;
});
