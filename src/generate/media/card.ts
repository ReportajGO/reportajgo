import { existsSync, readdirSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { createCanvas, loadImage, GlobalFonts, type SKRSContext2D } from "@napi-rs/canvas";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";

const log = logger.child({ module: "card" });

// 4:5 portrait — the channel's standard post card.
const WIDTH = 1080;
const HEIGHT = 1350;
const MARGIN = 64;

// Headline typography (scaled for 1080-wide canvas).
const FONT_SIZE = 52;
const LINE_HEIGHT = 64;
const MAX_LINES = 4;
const BAR_WIDTH = 12;
const BAR_GAP = 28; // space between the red bar and the text
const BOTTOM_PAD = 150; // distance from canvas bottom to the last text baseline

const FONT_FAMILY = "BrandHeadline";

const BRAND_ROOT = isAbsolute(env.BRAND_DIR)
  ? env.BRAND_DIR
  : resolve(process.cwd(), env.BRAND_DIR);

let fontReady: boolean | undefined;
let logoPath: string | undefined;

/** Register the brand headline font once. Falls back to a system font. */
function ensureFont(): string {
  if (fontReady === undefined) {
    const candidates = readDirSafe(BRAND_ROOT).filter((f) => /\.(ttf|otf|woff2?)$/i.test(f));
    const fontFile = candidates.find((f) => /headline/i.test(f)) ?? candidates[0];
    if (fontFile && GlobalFonts.registerFromPath(join(BRAND_ROOT, fontFile), FONT_FAMILY)) {
      fontReady = true;
      log.info({ font: fontFile }, "brand font registered");
    } else {
      fontReady = false;
      log.warn({ dir: BRAND_ROOT }, "no brand font found; using system fallback");
    }
  }
  // Bold italic to match the brand look; keywords are harmless if the file is
  // already styled.
  return fontReady
    ? `italic 800 ${FONT_SIZE}px ${FONT_FAMILY}`
    : `italic 800 ${FONT_SIZE}px Arial, sans-serif`;
}

/** Locate the logo file (logo.png / logo.svg / first image named logo). */
function findLogo(): string | undefined {
  if (logoPath !== undefined) return logoPath || undefined;
  const files = readDirSafe(BRAND_ROOT);
  const found = files.find((f) => /^logo\.(png|jpe?g|webp)$/i.test(f));
  logoPath = found ? join(BRAND_ROOT, found) : "";
  if (!found) log.warn({ dir: BRAND_ROOT }, "no logo file found (expected brand/logo.png)");
  return logoPath || undefined;
}

function readDirSafe(dir: string): string[] {
  try {
    return existsSync(dir) ? readdirSync(dir) : [];
  } catch {
    return [];
  }
}

/**
 * Return a canvas of the logo with near-white pixels made transparent, so a
 * logo supplied on a white background composites cleanly onto the photo.
 * If the logo already has transparency, the keying is effectively a no-op.
 */
function keyOutWhite(img: Awaited<ReturnType<typeof loadImage>>) {
  const c = createCanvas(img.width, img.height);
  const cx = c.getContext("2d");
  cx.drawImage(img, 0, 0);
  const data = cx.getImageData(0, 0, img.width, img.height);
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i]! > 238 && px[i + 1]! > 238 && px[i + 2]! > 238) px[i + 3] = 0;
  }
  cx.putImageData(data, 0, 0);
  return c;
}

/** Draw an image to cover the whole canvas (scale + center-crop). */
function drawCover(
  ctx: SKRSContext2D,
  img: Awaited<ReturnType<typeof loadImage>>,
): void {
  const scale = Math.max(WIDTH / img.width, HEIGHT / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  ctx.drawImage(img, (WIDTH - w) / 2, (HEIGHT - h) / 2, w, h);
}

/** Wrap uppercase text into lines that fit maxWidth. */
function wrapLines(ctx: SKRSContext2D, text: string, maxWidth: number): string[] {
  const words = text.toUpperCase().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  if (lines.length > MAX_LINES) {
    const kept = lines.slice(0, MAX_LINES);
    kept[MAX_LINES - 1] = `${kept[MAX_LINES - 1]!.replace(/[.,;:]?$/, "")}…`;
    return kept;
  }
  return lines;
}

export interface CardOptions {
  /** Background image as a file path or raw image bytes. */
  background: string | Buffer;
  headline: string;
}

/**
 * Render the branded news card: background photo (cover) + bottom darkening
 * gradient + GO logo top-right + red accent bar + white bold-italic uppercase
 * headline anchored bottom-left. Returns a PNG buffer.
 */
export async function renderNewsCard(opts: CardOptions): Promise<Buffer> {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext("2d");

  // 1) Background
  const bg = await loadImage(opts.background);
  drawCover(ctx, bg);

  // 2) Bottom darkening gradient for headline legibility. Reaches full opacity
  // at the very bottom so any stray edge artifacts in the photo are buried.
  const grad = ctx.createLinearGradient(0, HEIGHT * 0.45, 0, HEIGHT);
  grad.addColorStop(0, "rgba(0,0,0,0)");
  grad.addColorStop(0.5, "rgba(0,0,0,0.45)");
  grad.addColorStop(0.82, "rgba(0,0,0,0.92)");
  grad.addColorStop(1, "rgba(0,0,0,1)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // 3) Logo top-right (white background keyed out so it sits on the photo)
  const logo = findLogo();
  if (logo) {
    try {
      const img = await loadImage(logo);
      const keyed = keyOutWhite(img);
      const targetH = 104;
      const ratio = img.width / img.height;
      const w = targetH * ratio;
      ctx.drawImage(keyed, WIDTH - MARGIN - w, 48, w, targetH);
    } catch (err) {
      log.warn({ err }, "failed to draw logo");
    }
  }

  // 4) Headline (wrapped) + red accent bar
  ctx.font = ensureFont();
  ctx.textBaseline = "alphabetic";
  const textX = MARGIN + BAR_WIDTH + BAR_GAP;
  const maxTextWidth = WIDTH - textX - MARGIN;
  const lines = wrapLines(ctx, opts.headline, maxTextWidth);

  const blockHeight = lines.length * LINE_HEIGHT;
  const firstBaseline = HEIGHT - BOTTOM_PAD - (lines.length - 1) * LINE_HEIGHT;
  const barTop = firstBaseline - FONT_SIZE + 8;

  // red bar
  ctx.fillStyle = env.BRAND_ACCENT_COLOR;
  ctx.fillRect(MARGIN, barTop, BAR_WIDTH, blockHeight - (LINE_HEIGHT - FONT_SIZE) + 4);

  // headline text with a soft shadow for contrast
  ctx.fillStyle = "#FFFFFF";
  ctx.shadowColor = "rgba(0,0,0,0.55)";
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 2;
  lines.forEach((line, i) => {
    ctx.fillText(line, textX, firstBaseline + i * LINE_HEIGHT);
  });
  ctx.shadowBlur = 0;

  return canvas.toBuffer("image/png");
}
