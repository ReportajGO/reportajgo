// Render a sample post card from the reproduced template.
//   npx tsx src/scripts/render-template-sample.mts ["headline"] [photo] [out]
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { renderTemplateCard } from "../generate/media/templateCard.js";

const headline =
  process.argv[2] ||
  "Ertangi o‘yin osonroq bo‘ladi — Fabio Kannavaro Kongo DR bilan bahs oldidan fikr bildirdi";
const photo = resolve(process.argv[3] || "brand/reference.png");
const out = resolve(process.argv[4] || ".canva-debug/template-sample.png");

const buf = await renderTemplateCard({ background: photo, headline });
await writeFile(out, buf);
console.log(`✓ wrote ${out} (${(buf.length / 1024).toFixed(1)} kb)`);
