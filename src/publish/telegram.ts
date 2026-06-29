import { existsSync } from "node:fs";
import { join } from "node:path";
import { Telegraf } from "telegraf";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import type { Platform } from "../domain/types.js";
import { MEDIA_ROOT } from "../generate/media/mediaStore.js";
import type { Publisher, PublishInput, PublishResult } from "./publisher.js";

const log = logger.child({ module: "publish:telegram" });

// Telegram caption cap (visible text) when sending with media.
const CAPTION_CAP = 1024;
// Cap for text-only messages.
const MESSAGE_CAP = 4096;
// "Details 👇👇👇" line that precedes the website link.
const DETAILS_LABEL = "Batafsil 👇👇👇";
// Call-to-subscribe line above the channel links.
const SUBSCRIBE_LABEL = "Rasmiy sahifalarimizga obuna bo‘ling:";

function escapeHtml(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Escape a URL for safe use inside an href="" attribute. */
function escapeAttr(url: string): string {
  return url.replace(/&/g, "&amp;").replace(/"/g, "%22");
}

/** Visible length of an HTML caption (Telegram counts text, not the tags). */
function visibleLen(html: string): number {
  return html.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").length;
}

/**
 * Resolve a media URL into something Telegram can send. Telegram's servers can't
 * fetch a localhost/private URL, so for our own /media/<file> assets we upload
 * the file straight from disk; remote URLs are passed through unchanged.
 */
function mediaSource(url: string): string | { source: string } {
  const marker = "/media/";
  const idx = url.indexOf(marker);
  if (idx !== -1) {
    const path = join(MEDIA_ROOT, url.slice(idx + marker.length));
    if (existsSync(path)) return { source: path };
  }
  return url;
}

/** A channel link: hyperlinked label when a URL is set, else plain text. */
function channelLink(label: string, url?: string): string {
  return url ? `<a href="${escapeAttr(url)}">${label}</a>` : label;
}

/** The "subscribe" row: Telegram | Instagram | YouTube. */
function buildChannelLinks(): string {
  return [
    channelLink("Telegram", env.BRAND_TELEGRAM_URL),
    channelLink("Instagram", env.BRAND_INSTAGRAM_URL),
    channelLink("YouTube", env.BRAND_YOUTUBE_URL),
  ].join(" | ");
}

/**
 * Build the Telegram channel caption — short and link-led:
 *
 *   <b>Headline</b>
 *
 *   Batafsil 👇👇👇
 *   https://site/uz/article/…        ← the live website article link
 *
 *   Rasmiy sahifalarimizga obuna bo‘ling:
 *   Telegram | Instagram | YouTube
 *
 * Just the headline + links (the full write-up lives on the website, linked
 * here). The longer article-style caption is used for Instagram, not Telegram.
 */
export function buildTelegramCaption(input: PublishInput, cap = CAPTION_CAP): string {
  const headline = input.article?.title?.trim();
  const parts: string[] = [];

  if (headline) parts.push(`<b>${escapeHtml(headline)}</b>`);
  // "Batafsil 👇👇👇" + the raw article URL (Telegram auto-links it).
  if (input.articleUrl) parts.push(`${DETAILS_LABEL}\n${input.articleUrl}`);
  parts.push(`${SUBSCRIBE_LABEL}\n${buildChannelLinks()}`);

  let caption = parts.join("\n\n");
  // Safety net — the template is short, but never exceed Telegram's cap.
  if (visibleLen(caption) > cap) caption = caption.slice(0, cap);
  return caption;
}

export class TelegramPublisher implements Publisher {
  readonly platform: Platform = "TELEGRAM";
  private bot: Telegraf;
  private channel: string;

  constructor() {
    // Reuse the approval bot's token if a dedicated channel-posting token isn't
    // set — a single bot can both DM approvers and post to the channel.
    const token = env.TELEGRAM_BOT_TOKEN || env.TELEGRAM_APPROVAL_BOT_TOKEN;
    if (!token) throw new Error("TELEGRAM_BOT_TOKEN (or TELEGRAM_APPROVAL_BOT_TOKEN) is not set");
    if (!env.TELEGRAM_CHANNEL_ID) throw new Error("TELEGRAM_CHANNEL_ID is not set");
    this.bot = new Telegraf(token);
    this.channel = env.TELEGRAM_CHANNEL_ID;
  }

  async publish(input: PublishInput): Promise<PublishResult> {
    const caption = buildTelegramCaption(input);
    const video = input.media.find((m) => m.type === "VIDEO");
    const image = input.media.find((m) => m.type === "IMAGE");

    let messageId: number;
    if (video) {
      const msg = await this.bot.telegram.sendVideo(this.channel, mediaSource(video.url), {
        caption,
        parse_mode: "HTML",
      });
      messageId = msg.message_id;
    } else if (image) {
      const msg = await this.bot.telegram.sendPhoto(this.channel, mediaSource(image.url), {
        caption,
        parse_mode: "HTML",
      });
      messageId = msg.message_id;
    } else {
      // Text-only: messages allow up to 4096 visible characters.
      const msg = await this.bot.telegram.sendMessage(
        this.channel,
        buildTelegramCaption(input, MESSAGE_CAP),
        { parse_mode: "HTML", link_preview_options: { is_disabled: true } },
      );
      messageId = msg.message_id;
    }

    log.info({ messageId, channel: this.channel }, "published to telegram");
    return { externalPostId: String(messageId), url: this.postUrl(messageId) };
  }

  /** Build a t.me link for public @channels. */
  private postUrl(messageId: number): string | undefined {
    if (this.channel.startsWith("@")) {
      return `https://t.me/${this.channel.slice(1)}/${messageId}`;
    }
    return undefined;
  }
}
