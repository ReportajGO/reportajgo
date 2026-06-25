import { prisma } from "../src/db/client.js";
import { HiggsfieldMcpProvider } from "../src/generate/media/higgsfieldMcp.js";
import { renderNewsCard } from "../src/generate/media/card.js";
import { saveImage } from "../src/generate/media/mediaStore.js";
import { generateCardHeadline } from "../src/generate/copy/headline.js";
import type { AspectRatio } from "../src/domain/types.js";

const provider = new HiggsfieldMcpProvider();
// Regenerate IMAGE media for approval-ready posts with Higgsfield backgrounds
// and the themed (post-language) card headline.
const drafts = await prisma.postDraft.findMany({
  where: { status: "PENDING_APPROVAL" },
  include: {
    newsItem: { select: { title: true, summary: true } },
    media: { where: { type: "IMAGE" }, orderBy: { createdAt: "desc" }, take: 1 },
  },
});

let done = 0, skipped = 0, failed = 0;
for (const d of drafts) {
  const asset = d.media[0];
  if (!asset) { skipped++; continue; }
  const prompt = asset.prompt;
  if (!prompt) { skipped++; continue; }
  try {
    // Ensure the draft has a themed headline (generate + persist if missing).
    let headline = d.headline?.trim();
    if (!headline) {
      headline = await generateCardHeadline(
        { title: d.newsItem.title, summary: d.newsItem.summary },
        d.language,
      );
      await prisma.postDraft.update({ where: { id: d.id }, data: { headline } });
    }

    const bg = await provider.generateImage({ prompt, aspectRatio: (asset.aspectRatio as AspectRatio) ?? "4:5" });
    if (bg.status !== "READY" || !bg.url) throw new Error(bg.error ?? "no bg");
    const res = await fetch(bg.url);
    const buf = Buffer.from(await res.arrayBuffer());
    const card = await renderNewsCard({ background: buf, headline });
    const stored = await saveImage(card, "image/png");
    await prisma.mediaAsset.update({
      where: { id: asset.id },
      data: { url: stored.url, provider: "higgsfield-mcp+card", externalJobId: bg.externalJobId ?? null, status: "READY" },
    });
    done++;
    console.log(`[${done}] ${headline.slice(0, 70)}`);
  } catch (err) {
    failed++;
    console.log(`FAIL: ${d.newsItem.title.slice(0,50)} :: ${err instanceof Error ? err.message : err}`);
  }
}
console.log(`REGEN_DONE done=${done} skipped=${skipped} failed=${failed}`);
await prisma.$disconnect();
