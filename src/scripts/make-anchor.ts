/**
 * SCRIPT 5 — the news presenter robot.
 *
 * "Make a video of her reading this", as one command: the script goes to
 * ElevenLabs in her cloned voice, the WAV is stored, and Higgsfield Speak
 * animates her photo in sync with it. Vertical 9:16, for Reels/Shorts/Telegram.
 *
 *   # narrate an arbitrary line
 *   npx tsx src/scripts/make-anchor.ts --image brand/anchor.png --script "Assalomu alaykum…"
 *
 *   # narrate a real story from the DB (uses the draft headline + body)
 *   npx tsx src/scripts/make-anchor.ts --image brand/anchor.png --news <newsItemId>
 *
 *   # dry run: synthesize + measure the voice track, generate NO video
 *   npx tsx src/scripts/make-anchor.ts --script "…" --voice-only
 *
 * --image accepts a public URL, or a local file which is uploaded to the media
 * store first. Both the photo and the narration must be publicly fetchable —
 * Higgsfield pulls them over the network — so under MEDIA_STORAGE_DRIVER=local
 * set PUBLIC_BASE_URL to your real domain, or use the s3 driver.
 *
 * A clip is 5, 10 or 15 seconds — Speak has no other lengths. Roughly 35-40
 * words fit 15s; the script fails before spending credits if the voice track
 * comes back longer.
 *
 * In PRODUCTION (Docker, compiled dist/) run it in the worker container:
 *   docker compose exec backend-worker npm run anchor:video:prod -- --image <url> --script "…"
 */
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { env } from "../config/env.js";
import { renderAnchorVideo } from "../generate/media/anchorVideo.js";
import { synthesizeSpeech } from "../generate/media/elevenlabs.js";
import { saveAudio, saveImage } from "../generate/media/mediaStore.js";

// Speak caps a clip at 15s, so a story has to be read down to a bulletin line.
const MAX_SCRIPT_CHARS = 400;

function arg(name: string): string | undefined {
  const flag = `--${name}`;
  const i = process.argv.indexOf(flag);
  if (i !== -1) return process.argv[i + 1] && !process.argv[i + 1]!.startsWith("--") ? process.argv[i + 1] : "";
  const eq = process.argv.find((a) => a.startsWith(`${flag}=`));
  return eq ? eq.slice(flag.length + 1) : undefined;
}
const has = (name: string): boolean => process.argv.includes(`--${name}`);

function mimeForImage(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  return "image/png";
}

/** A public URL for her photo: pass one through, or upload a local file. */
async function resolveImageUrl(imageArg: string): Promise<string> {
  if (/^https?:\/\//i.test(imageArg)) return imageArg;

  const path = isAbsolute(imageArg) ? imageArg : resolve(process.cwd(), imageArg);
  if (!existsSync(path)) throw new Error(`presenter photo not found: ${path}`);
  const stored = await saveImage(await readFile(path), mimeForImage(path));
  console.log(`   uploaded photo → ${stored.url}`);
  return stored.url;
}

/** Narration text for a news item: the presenter reads the drafted post. */
async function scriptForNews(newsItemId: string): Promise<string> {
  const { prisma } = await import("../db/client.js");
  const draft = await prisma.postDraft.findFirst({
    where: { newsItemId },
    orderBy: { createdAt: "desc" },
    include: { newsItem: { select: { title: true, summary: true } } },
  });
  if (!draft) throw new Error(`no draft found for news item ${newsItemId}`);

  const spoken = [draft.headline?.trim() || draft.newsItem.title.trim(), draft.body.trim()]
    .filter(Boolean)
    .join(". ")
    // Hashtags and links are for the caption, not for reading aloud.
    .replace(/#[^\s#]+/g, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return spoken.slice(0, MAX_SCRIPT_CHARS);
}

async function main(): Promise<void> {
  const newsItemId = arg("news") || undefined;
  const scriptArg = arg("script");
  const voiceOnly = has("voice-only");

  const script = newsItemId ? await scriptForNews(newsItemId) : scriptArg;
  if (!script) throw new Error('Nothing to say. Pass --script "…" or --news <newsItemId>.');

  console.log(`\n🎙️  Voice: ${env.ELEVENLABS_VOICE_ID || "(ELEVENLABS_VOICE_ID unset)"} · ${env.ELEVENLABS_MODEL_ID}`);
  console.log(`   script: ${script.slice(0, 100)}${script.length > 100 ? "…" : ""}`);

  if (voiceOnly) {
    const speech = await synthesizeSpeech(script, arg("voice") || undefined);
    const stored = await saveAudio(speech.wav);
    console.log(`\n✅ narration ready — ${speech.seconds.toFixed(1)}s`);
    console.log(`   url  : ${stored.url}`);
    console.log(`   store: ${stored.path}`);
    if (speech.seconds > 15) console.log("   ⚠  longer than 15s — too long for one Speak clip.");
    return;
  }

  const imageArg = arg("image");
  if (!imageArg) throw new Error("Pass --image <path|url> — the presenter photo to animate.");
  const imageUrl = await resolveImageUrl(imageArg);

  console.log("\n🎬 Generating the presenter video (this takes a minute or two) …");
  const res = await renderAnchorVideo({
    script,
    imageUrl,
    ...(arg("voice") ? { voiceId: arg("voice")! } : {}),
    highQuality: has("hq"),
  });

  console.log(`\n   narration: ${res.scriptSeconds.toFixed(1)}s → ${res.audioUrl}`);
  if (res.status !== "READY") {
    throw new Error(`video generation failed: ${res.error ?? "unknown error"}`);
  }
  console.log(`\n✅ presenter video ready`);
  console.log(`   url: ${res.url}`);
  console.log(`   job: ${res.externalJobId}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n❌ make-anchor failed:", err?.message ?? err);
    process.exit(1);
  });
