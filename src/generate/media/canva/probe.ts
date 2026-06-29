// Calibration probe: open the template and dump every design element's role,
// label, and on-screen box (center x/y + size) from Canva's accessibility DOM.
// Use the output to fill brand/canva-template.json with headline/imageFrame x,y.
//
//   npm run canva:probe
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { CANVA_DEBUG_DIR } from "./config.js";
import { withEditor } from "./render.js";

async function main(): Promise<void> {
  await withEditor(async (page) => {
    const els = await page.$$eval('[id^="accessibility_dom-"]', (nodes) =>
      nodes.map((n) => {
        const r = n.getBoundingClientRect();
        return {
          id: n.id,
          role: n.getAttribute("role"),
          label: (n.getAttribute("aria-label") || "").slice(0, 70),
          x: Math.round(r.x + r.width / 2),
          y: Math.round(r.y + r.height / 2),
          w: Math.round(r.width),
          h: Math.round(r.height),
        };
      }),
    );
    console.log("\n=== design elements (id · role · center x,y · w×h · label) ===");
    for (const e of els) {
      console.log(
        `${e.id}  ${e.role}  @(${e.x},${e.y})  ${e.w}x${e.h}  "${e.label}"`,
      );
    }
    await mkdir(CANVA_DEBUG_DIR, { recursive: true });
    await writeFile(resolve(CANVA_DEBUG_DIR, "probe.json"), JSON.stringify(els, null, 2));
    await page.screenshot({ path: resolve(CANVA_DEBUG_DIR, "probe.png") });
    console.log(`\nSaved probe.json + probe.png to ${CANVA_DEBUG_DIR}`);
  });
  process.exit(0);
}

main().catch((err) => {
  console.error("canva:probe failed:", err);
  process.exit(1);
});
