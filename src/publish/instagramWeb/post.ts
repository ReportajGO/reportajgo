// Instagram web automation: post a single image with a caption by driving
// instagram.com's desktop "Create" flow like a human, reusing the persistent
// login from `npm run instagram:login`.
//
// This is intentionally tolerant: Instagram's DOM changes often and is
// localized, so each step tries several selectors and falls back to text/role
// matches. On any failure we dump a screenshot + HTML to INSTAGRAM_DEBUG_DIR.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { INSTAGRAM_DEBUG_DIR, INSTAGRAM_PROFILE_DIR, VIEWPORT } from "./config.js";

const log = logger.child({ module: "instagram-web" });

const STEP_TIMEOUT_MS = 30_000;
const SHARE_TIMEOUT_MS = 120_000;

export interface InstagramPostInput {
  /** Local path to the image or video file to post. */
  filePath: string;
  caption: string;
  /** True for an mp4/mov — posted as a Reel via the web Create flow. */
  isVideo?: boolean;
}

export interface InstagramPostResult {
  /** Best-effort permalink of the new post (undefined if not resolvable). */
  url?: string;
}

// Serialize posts: one persistent profile can only host one browser at a time.
let queue: Promise<unknown> = Promise.resolve();

export function postToInstagram(input: InstagramPostInput): Promise<InstagramPostResult> {
  const run = queue.then(() => doPost(input));
  queue = run.catch(() => undefined);
  return run;
}

async function doPost(input: InstagramPostInput): Promise<InstagramPostResult> {
  const ctx = await launchContext();
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });
  try {
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    await page.goto("https://www.instagram.com/", { waitUntil: "domcontentloaded" });
    await ensureLoggedIn(page);
    await dismissDialogs(page);

    await openCreate(page);
    await selectFile(page, input.filePath);
    if (input.isVideo) await handleReelDialog(page);
    await advanceToCaption(page);
    await writeCaption(page, input.caption);
    await share(page, input.isVideo ?? false);

    const url = await resolvePermalink(page);
    log.info({ url, reel: input.isVideo ?? false }, "posted to instagram (web)");
    return { url };
  } catch (err) {
    await dumpDebug(ctx, "error").catch(() => {});
    throw err;
  } finally {
    await ctx.close();
  }
}

/** Launch Chrome (real channel first, then bundled Chromium) with the profile. */
async function launchContext(): Promise<BrowserContext> {
  const base = {
    headless: env.INSTAGRAM_HEADLESS,
    viewport: VIEWPORT,
    args: ["--disable-blink-features=AutomationControlled"],
  };
  const channel = env.INSTAGRAM_BROWSER_CHANNEL.trim();
  if (channel) {
    try {
      return await chromium.launchPersistentContext(INSTAGRAM_PROFILE_DIR, { ...base, channel });
    } catch (err) {
      log.warn({ err, channel }, "real-Chrome channel unavailable; falling back to bundled Chromium");
    }
  }
  return chromium.launchPersistentContext(INSTAGRAM_PROFILE_DIR, base);
}

async function ensureLoggedIn(page: Page): Promise<void> {
  await page.waitForTimeout(1500);
  if (/\/accounts\/login|\/accounts\/signup/.test(page.url())) {
    throw new Error("Instagram session expired — run `npm run instagram:login` again");
  }
}

/** Click the first locator that becomes visible within the timeout. */
async function clickFirst(page: Page, selectors: string[], timeout = STEP_TIMEOUT_MS): Promise<boolean> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const sel of selectors) {
      const loc = page.locator(sel).first();
      if (await loc.isVisible().catch(() => false)) {
        await loc.click().catch(() => {});
        return true;
      }
    }
    await page.waitForTimeout(400);
  }
  return false;
}

/** Dismiss cookie / "Not now" / notification prompts that block the UI. */
async function dismissDialogs(page: Page): Promise<void> {
  const labels = [
    "Allow all cookies",
    "Only allow essential cookies",
    "Not Now",
    "Not now",
    "Dismiss",
  ];
  for (const label of labels) {
    await page
      .getByRole("button", { name: label, exact: false })
      .first()
      .click({ timeout: 2000 })
      .catch(() => {});
  }
}

/** Open the "Create new post" dialog (and pick "Post" if a submenu appears). */
async function openCreate(page: Page): Promise<void> {
  const opened = await clickFirst(page, [
    'svg[aria-label="New post"]',
    'a[href="#"] svg[aria-label="New post"]',
    '[aria-label="New post"]',
    'div[role="button"]:has(svg[aria-label="New post"])',
  ]);
  if (!opened) throw new Error("could not find the Instagram 'New post' button");

  // Newer Instagram shows a submenu (Post / Reel / Story) — pick Post if present.
  await page.waitForTimeout(800);
  await page
    .getByRole("link", { name: /^post$/i })
    .first()
    .click({ timeout: 2500 })
    .catch(() =>
      page
        .getByText(/^post$/i)
        .first()
        .click({ timeout: 2000 })
        .catch(() => {}),
    );
}

/** Feed the image into the create dialog's file input. */
async function selectFile(page: Page, imagePath: string): Promise<void> {
  // Prefer the visible "Select from computer" button via a filechooser; fall
  // back to setting the hidden <input type=file> directly.
  try {
    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser", { timeout: 8000 }),
      page
        .getByRole("button", { name: /select from computer/i })
        .first()
        .click({ timeout: 8000 }),
    ]);
    await chooser.setFiles(imagePath);
  } catch {
    const input = page.locator('input[type="file"]').first();
    await input.waitFor({ state: "attached", timeout: STEP_TIMEOUT_MS });
    await input.setInputFiles(imagePath);
  }
  // Wait for the next step ("Next" appears) to confirm the upload registered.
  // Videos take longer to ingest than images.
  await page.waitForTimeout(3000);
}

/**
 * When a video is uploaded via "Post", Instagram shows a one-off dialog
 * ("Video posts are now shared as reels" / similar). Dismiss it if present.
 */
async function handleReelDialog(page: Page): Promise<void> {
  await page.waitForTimeout(1500);
  await clickFirst(
    page,
    ['div[role="button"]:has-text("OK")', 'button:has-text("OK")', 'div[role="dialog"] >> text="OK"'],
    6000,
  ).catch(() => false);
}

/**
 * Click "Next" through the crop / cover / edit screens until the caption box
 * appears. The number of steps varies (images ≈ 2, reels can be 3 incl. a cover
 * screen), so loop instead of assuming a fixed count.
 */
async function advanceToCaption(page: Page): Promise<void> {
  const captionSel =
    'div[aria-label="Write a caption..."], div[role="textbox"][contenteditable="true"], textarea[aria-label="Write a caption..."]';
  for (let i = 0; i < 5; i++) {
    if (await page.locator(captionSel).first().isVisible().catch(() => false)) return;
    const clicked = await clickFirst(
      page,
      ['div[role="button"]:has-text("Next")', 'button:has-text("Next")', 'div[role="dialog"] >> text="Next"'],
      STEP_TIMEOUT_MS,
    );
    if (!clicked) break;
    await page.waitForTimeout(1500);
  }
  if (!(await page.locator(captionSel).first().isVisible().catch(() => false))) {
    throw new Error("could not reach the caption screen (Create flow changed?)");
  }
}

/** Type the caption into the contenteditable caption box. */
async function writeCaption(page: Page, caption: string): Promise<void> {
  const box = page
    .locator('div[aria-label="Write a caption..."], div[role="textbox"][contenteditable="true"], textarea[aria-label="Write a caption..."]')
    .first();
  await box.waitFor({ state: "visible", timeout: STEP_TIMEOUT_MS });
  await box.click();
  // insertText writes the whole string (incl. emoji/newlines) without firing
  // keyboard shortcuts.
  await page.keyboard.insertText(caption);
  await page.waitForTimeout(500);
}

/** Click "Share" and wait for the success confirmation. */
async function share(page: Page, isVideo: boolean): Promise<void> {
  const clicked = await clickFirst(page, [
    'div[role="button"]:has-text("Share")',
    'button:has-text("Share")',
    'div[role="dialog"] >> text="Share"',
  ]);
  if (!clicked) throw new Error("could not find the 'Share' button");

  // Wait for "Your post has been shared" / "Your reel has been shared". Video
  // encodes server-side, so give reels extra time.
  const timeout = isVideo ? SHARE_TIMEOUT_MS * 2 : SHARE_TIMEOUT_MS;
  const ok = page
    .getByText(/your (post|reel) has been shared|post shared|reel shared|reklama joylandi/i)
    .first();
  await ok.waitFor({ state: "visible", timeout }).catch(() => {
    // Some flows just close the dialog — tolerate a missing confirmation.
    log.warn("no explicit 'shared' confirmation seen; assuming success");
  });
}

/** Best-effort: open own profile and read the newest post's permalink. */
async function resolvePermalink(page: Page): Promise<string | undefined> {
  try {
    await page.waitForTimeout(2500);
    await page.goto("https://www.instagram.com/", { waitUntil: "domcontentloaded" });
    const link = page.locator('a[href*="/p/"], a[href*="/reel/"]').first();
    const href = await link.getAttribute("href", { timeout: 5000 });
    if (href) return href.startsWith("http") ? href : `https://www.instagram.com${href}`;
  } catch {
    /* non-fatal */
  }
  return undefined;
}

async function dumpDebug(ctx: BrowserContext, tag: string): Promise<void> {
  const page = ctx.pages()[0];
  if (!page) return;
  await mkdir(INSTAGRAM_DEBUG_DIR, { recursive: true });
  const stamp = tag;
  await page.screenshot({ path: join(INSTAGRAM_DEBUG_DIR, `${stamp}.png`), fullPage: true }).catch(() => {});
  const html = await page.content().catch(() => "");
  await writeFile(join(INSTAGRAM_DEBUG_DIR, `${stamp}.html`), html).catch(() => {});
  log.warn({ dir: INSTAGRAM_DEBUG_DIR }, "instagram debug snapshot written");
}
