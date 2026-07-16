/**
 * SCRIPT 2 — the "Canva" branded-card step.
 *
 * Takes a background photo (local path OR https URL) + a headline and composites
 * the branded ReportajGO card — the same card the Canva template produces, drawn
 * in code by templateCard.ts (CARD_RENDERER=template). The real-browser Canva
 * renderer is brittle/broken, so this code reproduction is the working path.
 *
 *   npx tsx src/scripts/make-card.ts --photo path/to/photo.jpg --headline "Text"
 *   npx tsx src/scripts/make-card.ts --photo https://…/photo.png --headline "Text" --out card.png
 *
 * In PRODUCTION (Docker, compiled dist/):
 *   docker compose exec backend-worker npm run make:card:prod -- --photo <url> --headline "..."
 */
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { fetchImageBytes, saveBrandedCard } from "../generate/media/robot.js";

function arg(name: string): string | undefined {
  const flag = `--${name}`;
  const i = process.argv.indexOf(flag);
  if (i !== -1) return process.argv[i + 1] && !process.argv[i + 1]!.startsWith("--") ? process.argv[i + 1] : "";
  const eq = process.argv.find((a) => a.startsWith(`${flag}=`));
  return eq ? eq.slice(flag.length + 1) : undefined;
}

/** Load the background photo bytes from an https URL or a local file path. */
async function loadPhoto(source: string): Promise<Buffer> {
  if (/^https?:\/\//i.test(source)) return fetchImageBytes(source);
  const path = isAbsolute(source) ? source : resolve(process.cwd(), source);
  if (!existsSync(path)) throw new Error(`photo not found: ${path}`);
  return readFile(path);
}

async function main(): Promise<void> {
  const photo = arg("photo");
  const headline = arg("headline");
  if (!photo || !headline) {
    throw new Error('usage: make-card.ts --photo <path|url> --headline "..." [--out card.png]');
  }

  console.log(`🎴 Rendering branded card for: "${headline}"`);
  const bytes = await loadPhoto(photo);
  const card = await saveBrandedCard(bytes, headline);

  console.log(`\n✅ Card ready`);
  console.log(`   url  : ${card.cardUrl}`);
  console.log(`   store: ${card.cardPath}`);
  if (card.isLocal) console.log(`   open : ${pathToFileURL(card.cardPath).href}`);

  const out = arg("out");
  if (out) {
    const dest = isAbsolute(out) ? out : resolve(process.cwd(), out);
    await writeFile(dest, card.bytes); // from bytes, so it works under s3 too
    console.log(`   copy : ${dest}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n❌ make-card failed:", err?.message ?? err);
    process.exit(1);
  });
