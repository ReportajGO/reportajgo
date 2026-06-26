// Regenerate images for already-published WEBSITE posts to the new PURE style
// (real source photo first, else a clean generated image — no logo/headline),
// then push the refreshed photo to the website (matched by dedupeKey).
//   npx tsx src/scripts/regen-pure-website.mts
import { env } from "../config/env.js";
import { prisma } from "../db/client.js";
import { profileFor } from "../domain/platforms.js";
import type { AspectRatio } from "../domain/types.js";
import { getMediaProvider } from "../generate/media/index.js";
import { generateWebsiteImage } from "../generate/media/mediaService.js";
import { composePrompt, describeScene } from "../generate/media/prompts.js";

const ratio = profileFor("WEBSITE").media.aspectRatio as AspectRatio;

function absolutize(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  return `${env.PUBLIC_BASE_URL.replace(/\/+$/, "")}${url.startsWith("/") ? "" : "/"}${url}`;
}

async function run() {
  const drafts = await prisma.postDraft.findMany({
    where: { platform: "WEBSITE", status: "PUBLISHED" },
    include: { newsItem: true },
  });
  console.log(`regenerating pure images for ${drafts.length} published website posts...`);

  const provider = getMediaProvider();
  let ok = 0;
  let fail = 0;

  for (const d of drafts) {
    const title = d.headline?.trim() || d.newsItem.title;
    try {
      const scene = await describeScene(d.newsItem);
      const prompt = composePrompt(scene, "IMAGE");
      const img = await generateWebsiteImage(provider, d.newsItem.sourceUrl, prompt, ratio);
      if (img.status !== "READY" || !img.url) throw new Error(img.error || "no image");

      const res = await fetch(`${env.WEBSITE_API_URL.replace(/\/+$/, "")}/api/agent/posts?refreshImage=1`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${env.WEBSITE_API_KEY}` },
        body: JSON.stringify({ dedupeKey: d.newsItem.contentHash, imageUrl: absolutize(img.url) }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(`website ${res.status}: ${data.error ?? "?"}`);

      console.log(`✓ ${title.slice(0, 50)} [${img.provider}]`);
      ok++;
    } catch (err) {
      console.error(`✗ ${title.slice(0, 50)}: ${err instanceof Error ? err.message : String(err)}`);
      fail++;
    }
  }

  console.log(`\ndone: ${ok} refreshed, ${fail} failed`);
  await prisma.$disconnect();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
