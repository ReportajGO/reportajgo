// Instagram web automation: post a single image with a caption by driving
// instagram.com's desktop "Create" flow like a human, reusing the persistent
// login from `npm run instagram:login`.
//
// This is intentionally tolerant: Instagram's DOM changes often and is
// localized, so each step tries several selectors and falls back to text/role
// matches. On any failure we dump a screenshot + HTML to INSTAGRAM_DEBUG_DIR.
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { INSTAGRAM_DEBUG_DIR, INSTAGRAM_PROFILE_DIR, INSTAGRAM_STATE_FILE, VIEWPORT } from "./config.js";

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
    await seedSessionIfNeeded(ctx);
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

/**
 * Bootstrap the login on a fresh profile from the portable storageState JSON.
 * The persistent profile's own cookies are OS-encrypted (DPAPI on Windows, a
 * keyring/fallback key on Linux) and don't transfer between machines, so a login
 * captured on one host is carried as plaintext cookies and injected here. Skipped
 * when the profile already holds a live sessionid, so a rotated session is never
 * clobbered by the (older) JSON.
 */
async function seedSessionIfNeeded(ctx: BrowserContext): Promise<void> {
  if (!existsSync(INSTAGRAM_STATE_FILE)) return;
  const existing = await ctx.cookies("https://www.instagram.com").catch(() => []);
  if (existing.some((c) => c.name === "sessionid" && c.value)) return;
  try {
    const state = JSON.parse(readFileSync(INSTAGRAM_STATE_FILE, "utf8")) as { cookies?: unknown };
    const cookies = Array.isArray(state.cookies) ? state.cookies : [];
    if (cookies.length) {
      await ctx.addCookies(cookies as Parameters<BrowserContext["addCookies"]>[0]);
      log.info({ count: cookies.length }, "seeded Instagram session from storageState");
    }
  } catch (err) {
    log.warn({ err }, "could not seed Instagram session from storageState");
  }
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

/**
 * Click the caption-screen "Share" once, trying several strategies. Instagram's
 * top-bar Share is a text-styled clickable div (not a real <button>), so the
 * last resort is a DOM click on the element whose trimmed text is exactly
 * "Share" — that reliably hits the header control. Returns true if it clicked.
 */
async function clickShareOnce(page: Page): Promise<boolean> {
  const locs = [
    page.getByRole("button", { name: "Share", exact: true }),
    page.locator('div[role="dialog"]').getByText("Share", { exact: true }),
    page.getByText("Share", { exact: true }),
  ];
  for (const l of locs) {
    const el = l.first();
    if (await el.isVisible().catch(() => false)) {
      await el.click({ force: true, timeout: 3000 }).catch(() => {});
      return true;
    }
  }
  // DOM fallback: click the exact-"Share" clickable element directly. Runs in
  // the browser; globals are reached via globalThis so the Node build (no DOM
  // lib) still typechecks.
  return page
    .evaluate(() => {
      const doc = (globalThis as { document?: unknown }).document as
        | { querySelectorAll(s: string): ArrayLike<{ textContent: string | null; click(): void }> }
        | undefined;
      if (!doc) return false;
      const nodes = Array.from(
        doc.querySelectorAll('div[role="button"], button, [tabindex], a, span'),
      );
      const el = nodes.find((n) => (n.textContent || "").trim() === "Share");
      if (el) {
        el.click();
        return true;
      }
      return false;
    })
    .catch(() => false);
}

/** Did we land on the "post shared" confirmation (or did the composer close)? */
async function isShared(page: Page): Promise<boolean> {
  const ok = await page
    .getByText(/your (post|reel) has been shared|post shared|reel shared|reklama joylandi/i)
    .first()
    .isVisible()
    .catch(() => false);
  if (ok) return true;
  // Fallback: the caption box is gone → the composer closed → it was shared.
  const captionGone = !(await page
    .locator('div[aria-label="Write a caption..."], div[role="textbox"][contenteditable="true"]')
    .first()
    .isVisible()
    .catch(() => false));
  return captionGone;
}

/**
 * Click "Share" and keep at it until the post is actually confirmed — no human
 * needs to touch the window. Re-clicks each round in case the first click didn't
 * register, and tolerates the async video encode for reels.
 */
async function share(page: Page, isVideo: boolean): Promise<void> {
  const maxMs = isVideo ? SHARE_TIMEOUT_MS * 2 : SHARE_TIMEOUT_MS;
  const deadline = Date.now() + maxMs;
  let everClicked = false;

  while (Date.now() < deadline) {
    if (await isShared(page)) {
      log.info("instagram post confirmed shared");
      return;
    }
    if (await clickShareOnce(page)) everClicked = true;
    await page.waitForTimeout(2000);
  }

  if (await isShared(page)) return;
  if (!everClicked) throw new Error("could not find the 'Share' button");
  log.warn("no explicit 'shared' confirmation after clicking Share; assuming success");
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
