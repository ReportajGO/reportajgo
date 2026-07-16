/**
 * SCRIPT 3 — publish to Telegram + Instagram, and CHECK Instagram posting.
 *
 * By default this is a SAFE verification run: it drives the real instagram.com
 * "Create" flow (opens the browser, logs in from the saved session, uploads the
 * image, writes the caption) but STOPS right before the final Share — so you can
 * confirm posting works without actually publishing. Pass --publish to really post.
 *
 *   # verify only (no posting) — opens IG, proves the flow works, stops before Share
 *   npx tsx src/scripts/publish-check.ts
 *   npx tsx src/scripts/publish-check.ts --image media/xx.png --caption "Hello"
 *
 *   # actually publish the card to Instagram (+ Telegram if a real channel is set)
 *   npx tsx src/scripts/publish-check.ts --image media/xxx.png --caption "..." --publish
 *
 * Image defaults to the newest file in ./media (e.g. one just made by gen-images).
 * Under the s3 storage driver nothing is on local disk, so pass --image <url>
 * (the media URL gen-images printed) — it is downloaded to a temp file first.
 *
 * In PRODUCTION (Docker, compiled dist/), run it in the worker container (it holds
 * the logged-in .instagram-profile and the Xvfb display the headed browser needs):
 *   docker compose exec backend-worker npm run publish:check:prod -- --image <url>
 *   docker compose exec backend-worker npm run publish:check:prod -- --image <url> --publish
 *
 * NOTE: top-level imports are kept to node built-ins so we can set
 * INSTAGRAM_DRY_RUN *before* config/env.ts is evaluated (dotenv won't override an
 * already-set var). All app modules are imported dynamically below.
 */
import { config as loadDotenv } from "dotenv";
import { readdirSync, statSync, existsSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

loadDotenv();

function arg(name: string): string | undefined {
  const flag = `--${name}`;
  const i = process.argv.indexOf(flag);
  if (i !== -1) return process.argv[i + 1] && !process.argv[i + 1]!.startsWith("--") ? process.argv[i + 1] : "";
  const eq = process.argv.find((a) => a.startsWith(`${flag}=`));
  return eq ? eq.slice(flag.length + 1) : undefined;
}
const has = (name: string): boolean => process.argv.includes(`--${name}`);

/** Newest image file in ./media (or a directory given by MEDIA_DIR). */
function newestMedia(dir: string): string | undefined {
  if (!existsSync(dir)) return undefined;
  const files = readdirSync(dir)
    .filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
    .map((f) => ({ f: join(dir, f), t: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  return files[0]?.f;
}

/** Download a remote image URL to a temp file Playwright/Telegram can upload. */
async function downloadToTemp(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`failed to download image: HTTP ${res.status}`);
  const dir = await mkdtemp(join(tmpdir(), "pub-check-"));
  const ext = /\.(png|jpe?g|webp)(\?|$)/i.exec(url)?.[1] ?? "png";
  const path = join(dir, `image.${ext}`);
  await writeFile(path, Buffer.from(await res.arrayBuffer()));
  return path;
}

/**
 * Resolve the image to post to a LOCAL file path. Accepts an https URL (e.g. an
 * s3 media URL printed by gen-images), a local path, or — when nothing is given —
 * the newest file in the local media dir (only useful under the local driver).
 */
async function resolveImage(imageArg: string | undefined, mediaDir: string): Promise<string> {
  if (imageArg && /^https?:\/\//i.test(imageArg)) return downloadToTemp(imageArg);
  if (imageArg) {
    const path = isAbsolute(imageArg) ? imageArg : resolve(process.cwd(), imageArg);
    if (!existsSync(path)) throw new Error(`image not found: ${path}`);
    return path;
  }
  const newest = newestMedia(mediaDir);
  if (newest) return newest;
  throw new Error(
    "No image to post. Pass --image <path|url> (under the s3 storage driver nothing " +
      "is on local disk, so pass the media URL that gen-images printed), or run gen-images first.",
  );
}

async function main(): Promise<void> {
  const publish = has("publish");
  // Verify mode (default) → dry-run the Instagram flow (stop before Share).
  process.env.INSTAGRAM_DRY_RUN = publish ? "false" : "true";

  // Now it is safe to load config + app modules.
  const { env } = await import("../config/env.js");
  const mediaDir = isAbsolute(env.MEDIA_DIR) ? env.MEDIA_DIR : resolve(process.cwd(), env.MEDIA_DIR);

  // The Instagram web flow launches a HEADED Chromium. In the production worker
  // container a virtual display runs on :99 (Xvfb), but a `docker compose exec`
  // session doesn't inherit it — default DISPLAY so headed Chromium can start.
  if (process.platform === "linux" && !env.INSTAGRAM_HEADLESS && !process.env.DISPLAY) {
    process.env.DISPLAY = ":99";
    console.log("   (set DISPLAY=:99 for headed Chromium — matches the worker's Xvfb)");
  }

  const image = await resolveImage(arg("image"), mediaDir);
  const caption = arg("caption") || "ReportajGO — test post";
  const wantTelegram = !has("instagram-only");
  const wantInstagram = !has("telegram-only");

  console.log(`${publish ? "🚀 PUBLISH" : "🔎 VERIFY (no publishing)"} mode`);
  console.log(`   image  : ${image}`);
  console.log(`   caption: ${caption.slice(0, 60)}${caption.length > 60 ? "…" : ""}\n`);

  // ── Instagram ──────────────────────────────────────────────────────────────
  if (wantInstagram) {
    console.log("📸 Instagram (web automation)…");
    if (env.INSTAGRAM_PUBLISHER !== "web") {
      console.log(`   ⚠  INSTAGRAM_PUBLISHER=${env.INSTAGRAM_PUBLISHER} (checking the web flow anyway)`);
    }
    if (!existsSync(env.INSTAGRAM_STATE_FILE) && !existsSync(env.INSTAGRAM_PROFILE_DIR)) {
      console.log("   ⚠  no saved IG session — run `npm run instagram:login` first");
    }
    try {
      const { postToInstagram } = await import("../publish/instagramWeb/post.js");
      const res = await postToInstagram({ filePath: image, caption, isVideo: false });
      if (publish) {
        console.log(`   ✅ posted to Instagram${res.url ? ` → ${res.url}` : ""}`);
      } else {
        console.log("   ✅ VERIFIED: logged in, opened Create, uploaded image + caption, stopped before Share.");
        console.log("      Instagram posting works. Re-run with --publish --image <path> to post for real.");
      }
    } catch (err) {
      console.log(`   ❌ Instagram flow failed: ${(err as Error).message}`);
      console.log(`      debug snapshot (screenshot + HTML): ${env.INSTAGRAM_DEBUG_DIR}`);
    }
  }

  // ── Telegram ───────────────────────────────────────────────────────────────
  if (wantTelegram) {
    console.log("\n💬 Telegram channel…");
    const token = env.TELEGRAM_BOT_TOKEN || env.TELEGRAM_APPROVAL_BOT_TOKEN;
    const channel = env.TELEGRAM_CHANNEL_ID;
    const channelReady = Boolean(channel && channel !== "@your_channel");
    if (!token) {
      console.log("   ⚠  TELEGRAM_BOT_TOKEN not set — cannot post.");
    } else {
      const { Telegraf } = await import("telegraf");
      const bot = new Telegraf(token);
      try {
        const me = await bot.telegram.getMe();
        console.log(`   ✅ bot token valid (@${me.username})`);
      } catch (e) {
        console.log(`   ❌ bot token invalid: ${(e as Error).message}`);
      }
      if (!channelReady) {
        console.log(`   ⚠  TELEGRAM_CHANNEL_ID is "${channel}" (placeholder) — set a real @channel to post.`);
      } else if (publish) {
        try {
          const msg = await bot.telegram.sendPhoto(channel!, { source: image }, { caption });
          console.log(`   ✅ posted to Telegram (message ${msg.message_id})`);
        } catch (e) {
          console.log(`   ❌ Telegram post failed: ${(e as Error).message}`);
        }
      } else {
        console.log(`   ✅ channel ${channel} configured — ready to post (run with --publish).`);
      }
    }
  }

  console.log("\nDone.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n❌ publish-check failed:", err?.message ?? err);
    process.exit(1);
  });
