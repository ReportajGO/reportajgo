// Verify the REST Higgsfield key (HIGGSFIELD_CREDENTIALS) can do DoP
// image-to-video, and that the wallet has credits. Generates a public image via
// the MCP first, then animates it with REST DoP.
// Usage: npx tsx src/scripts/test-dop.ts
import { HiggsfieldProvider } from "../generate/media/higgsfield.js";
import { HiggsfieldMcpProvider } from "../generate/media/higgsfieldMcp.js";

async function main() {
  console.log("1) generating a source image via MCP (public CDN url)…");
  const mcp = new HiggsfieldMcpProvider();
  const img = await mcp.generateImage({
    prompt: "A modern TV news studio, vertical composition, cinematic lighting",
    aspectRatio: "9:16",
  });
  if (img.status !== "READY" || !img.url) {
    throw new Error(`image step failed: ${img.error ?? "no url"}`);
  }
  console.log("   image url:", img.url);

  console.log("2) animating it with REST DoP (image2video)…");
  const rest = new HiggsfieldProvider();
  const video = await rest.generateVideo({
    prompt: "Subtle cinematic camera push-in, gentle motion",
    aspectRatio: "9:16",
    sourceImageUrl: img.url,
  });
  console.log("   DoP result:", JSON.stringify(video, null, 2));
  if (video.status === "READY" && video.url) {
    console.log("\n✅ DoP works. Reel mp4:", video.url);
  } else {
    console.log("\n❌ DoP failed:", video.error);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\nDOP TEST FAILED:", err?.message ?? err);
    process.exit(1);
  });
