// Code reproduction of the ReportajGO Canva post template (1080×1080 square):
//   • full-bleed background photo
//   • floating white card (bottom) with a thick red rounded border
//   • black "REPORTAJGO" pill badge centered on the card's top edge
//   • black, bold, justified headline inside the card
//   • short tan underline accent, left-aligned
//
// Reference: brand/canva-template-reference.png (and the user's design screenshot).
import { existsSync } from "node:fs";
import { join, isAbsolute, resolve } from "node:path";
import { createCanvas, loadImage, GlobalFonts, type SKRSContext2D, type Image } from "@napi-rs/canvas";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";

const log = logger.child({ module: "template-card" });

// ── layout (px, in 1080×1080 space) ──────────────────────────────────────────
const SIZE = 1080;

// white card
const CARD_L = 112;
const CARD_R = 968;
const CARD_T = 668;
const CARD_B = 958;
const CARD_W = CARD_R - CARD_L;
const CARD_RADIUS = 46;
const CARD_BORDER = 10;
const TEXT_PAD = 46; // inner horizontal padding

// badge
const BADGE_H = 66;

// colors
const RED = env.BRAND_ACCENT_COLOR || "#E2231A";
const BLACK = "#111111";
const TEXT_COLOR = "#1A1A1A";
const UNDERLINE_COLOR = "#9C8A5E";
const WHITE = "#FFFFFF";

const BRAND_ROOT = isAbsolute(env.BRAND_DIR) ? env.BRAND_DIR : resolve(process.cwd(), env.BRAND_DIR);
// Full REPORTAJGO wordmark (used as-is in the badge when present).
const WORDMARK_PATH = join(BRAND_ROOT, "logo-wordmark.png");

// ── fonts ─────────────────────────────────────────────────────────────────────
const FAMILY = "TemplateBold";
let fontReady: boolean | undefined;

function ensureFont(): string {
  if (fontReady === undefined) {
    const candidates = [
      "C:/Windows/Fonts/segoeuib.ttf", // Segoe UI Bold
      "C:/Windows/Fonts/arialbd.ttf", // Arial Bold
      "C:/Windows/Fonts/bahnschrift.ttf",
      "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    ];
    const found = candidates.find((p) => existsSync(p));
    fontReady = found ? Boolean(GlobalFonts.registerFromPath(found, FAMILY)) : false;
    if (fontReady) log.info({ font: found }, "template card font registered");
    else log.warn("no bold system font found; using canvas default");
  }
  return fontReady ? FAMILY : "sans-serif";
}

// ── helpers ───────────────────────────────────────────────────────────────────
function roundRectPath(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function drawCover(ctx: SKRSContext2D, img: Image, x: number, y: number, w: number, h: number) {
  const scale = Math.max(w / img.width, h / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

/** Make near-white pixels transparent so a logo on white sits on the dark pill. */
function keyOutWhite(img: Image) {
  const c = createCanvas(img.width, img.height);
  const cx = c.getContext("2d");
  cx.drawImage(img, 0, 0);
  const data = cx.getImageData(0, 0, img.width, img.height);
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i]! > 240 && px[i + 1]! > 240 && px[i + 2]! > 240) px[i + 3] = 0;
  }
  cx.putImageData(data, 0, 0);
  return c;
}

function wrapLines(ctx: SKRSContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const cand = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(cand).width > maxWidth && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = cand;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = `${kept[maxLines - 1]!.replace(/[.,;:]?$/, "")}…`;
    return kept;
  }
  return lines;
}

/** Draw one line left-aligned, or word-justified to fill `maxWidth` (not the last line). */
function drawLine(
  ctx: SKRSContext2D,
  line: string,
  x: number,
  y: number,
  maxWidth: number,
  justify: boolean,
) {
  const words = line.split(" ");
  if (!justify || words.length === 1) {
    ctx.fillText(line, x, y);
    return;
  }
  const wordsW = words.reduce((s, w) => s + ctx.measureText(w).width, 0);
  const gap = (maxWidth - wordsW) / (words.length - 1);
  let cx = x;
  for (const w of words) {
    ctx.fillText(w, cx, y);
    cx += ctx.measureText(w).width + gap;
  }
}

function findLogo(): string | undefined {
  const f = ["logo.png", "logo.jpg", "logo.jpeg", "logo.webp"].find((n) => existsSync(join(BRAND_ROOT, n)));
  return f ? join(BRAND_ROOT, f) : undefined;
}

// ── badge ─────────────────────────────────────────────────────────────────────
async function drawBadge(ctx: SKRSContext2D, cx: number, cy: number) {
  // Preferred: the real REPORTAJGO wordmark, used as-is on a white red-bordered
  // pill (so the dark logo stays legible where the badge overlaps the photo).
  if (existsSync(WORDMARK_PATH)) {
    try {
      const logo = await loadImage(WORDMARK_PATH);
      const lw = 248;
      const lh = (logo.height / logo.width) * lw;
      const padX = 34;
      const padY = 16;
      const w = lw + padX * 2;
      const h = lh + padY * 2;
      const x = cx - w / 2;
      const y = cy - h / 2;
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,0.28)";
      ctx.shadowBlur = 20;
      ctx.shadowOffsetY = 5;
      ctx.fillStyle = WHITE;
      roundRectPath(ctx, x, y, w, h, h / 2);
      ctx.fill();
      ctx.restore();
      ctx.strokeStyle = RED;
      ctx.lineWidth = 4;
      roundRectPath(ctx, x, y, w, h, h / 2);
      ctx.stroke();
      ctx.drawImage(logo, cx - lw / 2, cy - lh / 2, lw, lh);
      return;
    } catch (err) {
      log.warn({ err }, "wordmark logo failed to load; falling back to text badge");
    }
  }

  const family = ensureFont();
  const text = "REPORTAJ";
  const fontPx = 38;
  ctx.font = `italic 800 ${fontPx}px ${family}`;
  const textW = ctx.measureText(text).width;

  // GO logo (red mark) sits after the wordmark
  let logo: ReturnType<typeof keyOutWhite> | undefined;
  let logoW = 0;
  const logoPath = findLogo();
  if (logoPath) {
    try {
      logo = keyOutWhite(await loadImage(logoPath));
      logoW = 58;
    } catch (err) {
      log.warn({ err }, "badge logo failed to load");
    }
  }

  const gap = logo ? 8 : 0;
  const contentW = textW + gap + logoW;
  const padX = 38;
  const w = contentW + padX * 2;

  // black pill with a soft shadow so it reads on the photo
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.30)";
  ctx.shadowBlur = 20;
  ctx.shadowOffsetY = 5;
  ctx.fillStyle = BLACK;
  roundRectPath(ctx, cx - w / 2, cy - BADGE_H / 2, w, BADGE_H, BADGE_H / 2);
  ctx.fill();
  ctx.restore();

  const startX = cx - contentW / 2;
  ctx.fillStyle = WHITE;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.font = `italic 800 ${fontPx}px ${family}`;
  ctx.fillText(text, startX, cy + 2);
  if (logo) ctx.drawImage(logo, startX + textW + gap, cy - logoW / 2, logoW, logoW);
}

export interface TemplateCardInput {
  background: string | Buffer;
  headline: string;
}

/** Render the branded square card and return a PNG buffer. */
export async function renderTemplateCard(input: TemplateCardInput): Promise<Buffer> {
  const family = ensureFont();
  const canvas = createCanvas(SIZE, SIZE);
  const ctx = canvas.getContext("2d");

  // 1) full-bleed background photo
  const bg = await loadImage(input.background);
  drawCover(ctx, bg, 0, 0, SIZE, SIZE);

  // 2) white card with red rounded border
  const cardH = CARD_B - CARD_T;
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.22)";
  ctx.shadowBlur = 28;
  ctx.shadowOffsetY = 10;
  ctx.fillStyle = WHITE;
  roundRectPath(ctx, CARD_L, CARD_T, CARD_W, cardH, CARD_RADIUS);
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = RED;
  ctx.lineWidth = CARD_BORDER;
  roundRectPath(ctx, CARD_L, CARD_T, CARD_W, cardH, CARD_RADIUS);
  ctx.stroke();

  // 3) headline (black, bold, justified) inside the card
  const maxWidth = CARD_W - TEXT_PAD * 2;
  const textX = CARD_L + TEXT_PAD;
  // size down a notch for long headlines
  let fontPx = 39;
  let lineH = 54;
  ctx.font = `800 ${fontPx}px ${family}`;
  let lines = wrapLines(ctx, input.headline, maxWidth, 4);
  if (lines.length >= 4) {
    fontPx = 33;
    lineH = 46;
    ctx.font = `800 ${fontPx}px ${family}`;
    lines = wrapLines(ctx, input.headline, maxWidth, 4);
  }

  // vertically center the text + underline block in the card's lower body
  const regionTop = CARD_T + 56;
  const regionBottom = CARD_B - 34;
  const underlineGap = 30;
  const blockH = lines.length * lineH + underlineGap;
  const firstBaseline = regionTop + Math.max(0, (regionBottom - regionTop - blockH) / 2) + fontPx * 0.8;

  ctx.fillStyle = TEXT_COLOR;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  lines.forEach((line, i) => {
    const justify = i < lines.length - 1; // last line stays left-aligned
    drawLine(ctx, line, textX, firstBaseline + i * lineH, maxWidth, justify);
  });

  // 4) tan underline accent, left-aligned, under the text
  const underlineY = firstBaseline + (lines.length - 1) * lineH + 22;
  ctx.fillStyle = UNDERLINE_COLOR;
  ctx.fillRect(textX, underlineY, 168, 4);

  // 5) badge centered on the card's top edge
  await drawBadge(ctx, SIZE / 2, CARD_T);

  return canvas.toBuffer("image/png");
}
