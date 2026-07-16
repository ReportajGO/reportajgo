/**
 * SCRIPT 1 — the Higgsfield image robot.
 *
 * "Open Higgsfield and generate a relatable photo for each news item", then
 * composite it into the branded ReportajGO card. Two modes:
 *
 *   • DB mode (default): generate media for every draft waiting in PENDING_MEDIA
 *     — the exact pipeline step, advancing each draft to PENDING_APPROVAL.
 *       npx tsx src/scripts/gen-images.ts
 *       npx tsx src/scripts/gen-images.ts --news <newsItemId>
 *     (needs Postgres up: `docker compose up -d`.)
 *
 *   • Ad-hoc mode: generate one card for a headline you pass, NO database needed.
 *     Proves the Higgsfield + card engine end-to-end and drops a PNG in ./media.
 *       npx tsx src/scripts/gen-images.ts --headline "Your headline here"
 *       npx tsx src/scripts/gen-images.ts --headline "..." --summary "..." --out card.png
 *
 * In PRODUCTION (Docker) the image ships compiled dist/ (no src/, no tsx). Run it
 * inside the worker container, which holds the Higgsfield token + media env:
 *   docker compose exec backend-worker npm run gen:images:prod -- --headline "..."
 */
import { writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { env } from "../config/env.js";
import { describeScene, composePrompt } from "../generate/media/prompts.js";
import { generateNewsPhoto, saveBrandedCard } from "../generate/media/robot.js";
import type { AspectRatio } from "../domain/types.js";

function arg(name: string): string | undefined {
  const flag = `--${name}`;
  const i = process.argv.indexOf(flag);
  if (i !== -1) return process.argv[i + 1] && !process.argv[i + 1]!.startsWith("--") ? process.argv[i + 1] : "";
  const eq = process.argv.find((a) => a.startsWith(`${flag}=`));
  return eq ? eq.slice(flag.length + 1) : undefined;
}

/** Ad-hoc: one headline → scene → Higgsfield photo → branded card → ./media. */
async function generateOne(headline: string, summary: string, topic: string, out?: string): Promise<void> {
  const ratio = env.BRAND_CARD_RATIO as AspectRatio;
  console.log(`\n🧠 Describing a visual scene for: "${headline}"`);
  const scene = await describeScene({ title: headline, summary, topic });
  console.log(`   scene → ${scene}`);

  console.log(`\n📸 Generating the Higgsfield photo (${ratio}) …`);
  const photo = await generateNewsPhoto(composePrompt(scene, "IMAGE"), ratio);
  console.log(`   photo → ${photo.url}`);

  console.log(`\n🎴 Compositing the branded ReportajGO card …`);
  const card = await saveBrandedCard(photo.bytes, headline);
  console.log(`\n✅ Card ready`);
  console.log(`   url  : ${card.cardUrl}`);
  console.log(`   store: ${card.cardPath}`);
  if (card.isLocal) console.log(`   open : ${pathToFileURL(card.cardPath).href}`);

  if (out) {
    const dest = isAbsolute(out) ? out : resolve(process.cwd(), out);
    await writeFile(dest, card.bytes); // from bytes, so it works under s3 too
    console.log(`   copy : ${dest}`);
  }
}

/** DB mode: run the real pipeline media step for pending drafts. */
async function generateForPending(newsItemId?: string): Promise<void> {
  const { prisma } = await import("../db/client.js");
  const { generateMediaForPendingDrafts } = await import("../generate/media/mediaService.js");
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    throw new Error(
      "Cannot reach Postgres. Start it first:  docker compose up -d\n" +
        "  (or use ad-hoc mode: --headline \"Your headline\")",
    );
  }
  console.log("🗞️  Generating media for drafts in PENDING_MEDIA …");
  const res = await generateMediaForPendingDrafts(newsItemId ? { newsItemId } : undefined);
  console.log(`\n✅ media generation complete — ready: ${res.ready}, failed: ${res.failed}`);

  const assets = await prisma.mediaAsset.findMany({
    where: { status: "READY", ...(newsItemId ? { draft: { newsItemId } } : {}) },
    orderBy: { createdAt: "desc" },
    take: res.ready || 10,
    select: { url: true, type: true, provider: true },
  });
  for (const a of assets) console.log(`   • ${a.type} ${a.provider} → ${a.url}`);
  await prisma.$disconnect();
}

async function main(): Promise<void> {
  const headline = arg("headline");
  if (headline) {
    await generateOne(headline, arg("summary") ?? "", arg("topic") ?? "", arg("out") || undefined);
  } else {
    await generateForPending(arg("news") || undefined);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n❌ gen-images failed:", err?.message ?? err);
    process.exit(1);
  });
