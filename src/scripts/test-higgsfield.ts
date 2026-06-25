// Smoke test: generates ONE image via Higgsfield to validate credentials.
// Requires HIGGSFIELD_CREDENTIALS ("KEY_ID:KEY_SECRET") in .env.
// Usage: npx tsx src/scripts/test-higgsfield.ts
import { getMediaProvider } from "../generate/media/index.js";
import { composePrompt } from "../generate/media/prompts.js";

async function main() {
  const provider = getMediaProvider();
  const prompt = composePrompt(
    "A calm city skyline of Tashkent at golden hour, wide establishing shot.",
    "IMAGE",
  );
  console.log("Generating test image (16:9)…");
  const result = await provider.generateImage({ prompt, aspectRatio: "16:9" });
  console.log("Result:", JSON.stringify(result, null, 2));
  if (result.status !== "READY") process.exitCode = 1;
}

main().catch((err) => {
  console.error("HIGGSFIELD TEST FAILED:", err?.message ?? err);
  process.exitCode = 1;
});
