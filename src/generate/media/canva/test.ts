// Calibration / smoke test for the Canva renderer.
//
//   npm run canva:test ["HEADLINE TEXT"] [path/to/photo.png]
//
// Runs ONE render against CANVA_TEMPLATE_URL and writes the result to
// .canva-debug/test-output.png. If no calibration map exists yet, it still
// opens the editor and exports it, and saves a debug screenshot you can use to
// read off the headline/image coordinates for brand/canva-template.json.
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { CANVA_DEBUG_DIR } from "./config.js";
import { renderWithCanva } from "./render.js";

async function main(): Promise<void> {
  const headline = process.argv[2] || "BREAKING: ReportajGO test headline";
  const imagePath = resolve(process.argv[3] || "brand/reference.png");

  console.log("Rendering via Canva…");
  console.log("  headline:", headline);
  console.log("  photo:   ", imagePath);

  const buf = await renderWithCanva({ headline, imagePath });

  await mkdir(CANVA_DEBUG_DIR, { recursive: true });
  const out = resolve(CANVA_DEBUG_DIR, "test-output.png");
  await writeFile(out, buf);
  console.log(`✓ wrote ${out} (${(buf.length / 1024).toFixed(1)} kb)`);
  process.exit(0);
}

main().catch((err) => {
  console.error("canva:test failed:", err);
  process.exit(1);
});
