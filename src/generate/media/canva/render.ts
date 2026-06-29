// Canva editor automation: open a template, fill in the headline + photo like a
// human, and export the PNG — all headless, reusing the persistent login.
//
// The fill steps are TEMPLATE-SPECIFIC and driven by a calibration map
// (brand/canva-template.json). Until that map exists the render still opens the
// design and exports it, and writes a debug screenshot so we can read off the
// coordinates of the headline/image elements.
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import AdmZip from "adm-zip";
import { chromium, type BrowserContext, type Page } from "playwright";
import { env } from "../../../config/env.js";
import { logger } from "../../../config/logger.js";
import {
  CANVA_DEBUG_DIR,
  CANVA_PROFILE_DIR,
  VIEWPORT,
  loadTemplateMap,
  type CanvaTemplateMap,
} from "./config.js";

const log = logger.child({ module: "canva-render" });

const EDITOR_READY_MS = 60_000;
const EXPORT_TIMEOUT_MS = 150_000;

export interface CanvaRenderInput {
  headline: string;
  /** Local path to the background photo to place in the template. */
  imagePath: string;
}

// Serialize renders: one persistent profile can only host one browser at a time.
let queue: Promise<unknown> = Promise.resolve();

export function renderWithCanva(input: CanvaRenderInput): Promise<Buffer> {
  const run = queue.then(() => doRender(input));
  // Keep the chain alive regardless of individual success/failure.
  queue = run.catch(() => undefined);
  return run;
}

async function doRender(input: CanvaRenderInput): Promise<Buffer> {
  const map = loadTemplateMap();
  return withEditor(async (page) => {
    await applyContent(page, input, map);
    return exportPng(page);
  });
}

/**
 * Open the template in a logged-in editor, run `fn`, and always clean up. On
 * failure, dump a debug screenshot + HTML. Shared by the renderer and the probe.
 */
export async function withEditor<T>(fn: (page: Page) => Promise<T>): Promise<T> {
  if (!env.CANVA_TEMPLATE_URL) {
    throw new Error("CANVA_TEMPLATE_URL is not set (the Canva template edit URL)");
  }
  const ctx = await launchContext();
  // Hide the most obvious automation tell before any page script runs.
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });
  try {
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    await page.goto(env.CANVA_TEMPLATE_URL!, { waitUntil: "domcontentloaded" });
    await ensureLoggedIn(page);
    await passChallenge(page);
    await waitForEditor(page);
    return await fn(page);
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
    headless: env.CANVA_HEADLESS,
    acceptDownloads: true,
    viewport: VIEWPORT,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--disable-features=IsolateOrigins,site-per-process",
    ],
  };
  const channel = env.CANVA_BROWSER_CHANNEL.trim();
  if (channel) {
    try {
      return await chromium.launchPersistentContext(CANVA_PROFILE_DIR, { ...base, channel });
    } catch (err) {
      log.warn({ err, channel }, "real-Chrome channel unavailable; falling back to bundled Chromium");
    }
  }
  return chromium.launchPersistentContext(CANVA_PROFILE_DIR, base);
}

/** Fail fast with a clear message if the saved session has expired. */
async function ensureLoggedIn(page: Page): Promise<void> {
  if (/\/login|\/signup/.test(page.url())) {
    throw new Error("Canva session expired — run `npm run canva:login` again");
  }
}

/**
 * Canva fronts the editor with a Cloudflare bot-check ("Verify you are human").
 * A real headed browser usually clears it automatically within a few seconds;
 * wait for that, and fail with a clear message if it doesn't.
 */
async function passChallenge(page: Page): Promise<void> {
  const isChallenge = async (): Promise<boolean> => {
    const t = (await page.title().catch(() => "")) + " " + (await page.locator("body").innerText().catch(() => ""));
    return /verify you are human|we'?ll have you designing again|just a moment|checking your browser/i.test(t);
  };
  if (!(await isChallenge())) return;
  log.warn("Cloudflare bot-check detected; waiting for it to clear (headed Chrome only)…");
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(1500);
    if (!(await isChallenge())) {
      log.info("bot-check cleared");
      return;
    }
  }
  throw new Error(
    "Canva's Cloudflare bot-check did not clear. This needs a real headed Chrome " +
      "session (CANVA_HEADLESS=false) on an interactive desktop; headless/server runs are blocked.",
  );
}

/** Wait until the design editor canvas is interactive. */
async function waitForEditor(page: Page): Promise<void> {
  // The editor mounts a main design surface; wait for the page to settle.
  await page.waitForLoadState("networkidle", { timeout: EDITOR_READY_MS }).catch(() => {});
  await page.waitForTimeout(2500);
}

/**
 * Fill the template. Coordinate-driven (from the calibration map) because the
 * Canva editor renders elements on a canvas with no stable DOM handles.
 */
async function applyContent(
  page: Page,
  input: CanvaRenderInput,
  map: CanvaTemplateMap,
): Promise<void> {
  if (!map.headline && !map.imageFrame) {
    log.warn(
      "no canva-template.json calibration map yet — exporting the template as-is. " +
        "Run `npm run canva:test` and use the debug screenshot to capture element coordinates.",
    );
    return;
  }

  // 1) Replace the background photo (upload → select frame → apply).
  if (map.imageFrame) {
    await uploadImage(page, input.imagePath);
    await page.mouse.click(map.imageFrame.x, map.imageFrame.y);
    await page.waitForTimeout(500);
    if (map.uploadThumb) {
      // Double-click the uploaded thumbnail to drop it into the selected frame.
      await page.mouse.dblclick(map.uploadThumb.x, map.uploadThumb.y);
      await page.waitForTimeout(1500);
    }
  }

  // 2) Replace the headline text.
  if (map.headline) {
    await page.mouse.dblclick(map.headline.x, map.headline.y);
    await page.waitForTimeout(400);
    await page.keyboard.press("Control+A");
    await page.keyboard.press("Delete");
    await page.keyboard.type(input.headline, { delay: 12 });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
  }
}

/** Open the Uploads panel and push a local file into the hidden file input. */
async function uploadImage(page: Page, imagePath: string): Promise<void> {
  // Canva exposes a hidden <input type="file"> once the Uploads tab is opened.
  const uploadsTab = page.getByRole("tab", { name: /upload/i }).first();
  if (await uploadsTab.count()) {
    await uploadsTab.click().catch(() => {});
    await page.waitForTimeout(800);
  }
  const fileInput = page.locator('input[type="file"]').first();
  await fileInput.setInputFiles(imagePath);
  // Wait for the upload to finish (thumbnail appears).
  await page.waitForTimeout(4000);
}

// Bilingual (EN/RU) accessible-name patterns — the user's Canva UI is Russian.
const RE_SHARE = /share|поделиться/i;
const RE_DOWNLOAD = /download|скачать/i;
const RE_FILETYPE = /file type|тип файла|suggested|PNG|JPG/i;

/** Canva controls can be role=button OR role=menuitem; match either, plus text. */
function control(page: Page, re: RegExp) {
  return page
    .getByRole("button", { name: re })
    .or(page.getByRole("menuitem", { name: re }))
    .first();
}

/** Share → Download → PNG → capture the downloaded file as a Buffer. */
async function exportPng(page: Page): Promise<Buffer> {
  const clickByName = async (re: RegExp, timeout = 8000): Promise<boolean> => {
    const el = control(page, re);
    try {
      await el.waitFor({ state: "visible", timeout });
    } catch {
      return false;
    }
    await el.click();
    await page.waitForTimeout(1000);
    return true;
  };

  // Deselect any active element so the top bar is fully interactive.
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(400);

  // Share button can take a moment to appear after the editor settles.
  if (!(await clickByName(RE_SHARE, 30_000))) {
    log.warn("Share/Поделиться not found; trying Download directly");
  }
  await clickByName(RE_DOWNLOAD, 10_000);

  // Ensure file type is PNG when a type selector is shown.
  const typeTrigger = page.getByRole("button", { name: RE_FILETYPE }).first();
  if (await typeTrigger.count()) {
    await typeTrigger.click().catch(() => {});
    await page.getByRole("option", { name: /png/i }).first().click().catch(() => {});
    await page.waitForTimeout(400);
  }

  const downloadPromise = page.waitForEvent("download", { timeout: EXPORT_TIMEOUT_MS });
  // The final confirm button is also labelled Download/Скачать.
  await clickByName(RE_DOWNLOAD, 10_000);
  const download = await downloadPromise;

  const dir = await mkdtemp(join(tmpdir(), "canva-"));
  const out = join(dir, "export.bin");
  await download.saveAs(out);
  const bytes = await readFile(out);

  // Multi-page designs export as a ZIP of PNGs (1.png, 2.png…). Take page 1.
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const entries = new AdmZip(bytes)
      .getEntries()
      .filter((e) => /\.png$/i.test(e.entryName))
      .sort((a, b) => a.entryName.localeCompare(b.entryName, undefined, { numeric: true }));
    if (entries.length === 0) throw new Error("Canva export ZIP contained no PNG pages");
    log.info({ page: entries[0]!.entryName }, "extracted page 1 from canva export ZIP");
    return entries[0]!.getData();
  }
  log.info({ out }, "canva export downloaded (single PNG)");
  return bytes;
}

/** Save a screenshot + HTML of the current page for calibration/debugging. */
async function dumpDebug(ctx: BrowserContext, tag: string): Promise<void> {
  const page = ctx.pages()[0];
  if (!page) return;
  await mkdir(CANVA_DEBUG_DIR, { recursive: true });
  const stamp = `${tag}-${page.url().slice(-12).replace(/\W/g, "")}`;
  const shot = join(CANVA_DEBUG_DIR, `${stamp}.png`);
  await page.screenshot({ path: shot, fullPage: false }).catch(() => {});
  await writeFile(join(CANVA_DEBUG_DIR, `${stamp}.html`), await page.content()).catch(() => {});
  log.warn({ shot }, "canva debug screenshot saved");
}
