import { Telegraf } from "telegraf";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import type { Platform } from "../domain/types.js";
import { buildCaption, type Publisher, type PublishInput, type PublishResult } from "./publisher.js";

const log = logger.child({ module: "publish:telegram" });

// Telegram caption cap when sending with media.
const CAPTION_CAP = 1024;

export class TelegramPublisher implements Publisher {
  readonly platform: Platform = "TELEGRAM";
  private bot: Telegraf;
  private channel: string;

  constructor() {
    if (!env.TELEGRAM_BOT_TOKEN) throw new Error("TELEGRAM_BOT_TOKEN is not set");
    if (!env.TELEGRAM_CHANNEL_ID) throw new Error("TELEGRAM_CHANNEL_ID is not set");
    this.bot = new Telegraf(env.TELEGRAM_BOT_TOKEN);
    this.channel = env.TELEGRAM_CHANNEL_ID;
  }

  async publish(input: PublishInput): Promise<PublishResult> {
    const caption = buildCaption(input);
    const video = input.media.find((m) => m.type === "VIDEO");
    const image = input.media.find((m) => m.type === "IMAGE");

    let messageId: number;
    if (video) {
      const msg = await this.bot.telegram.sendVideo(this.channel, video.url, {
        caption: caption.slice(0, CAPTION_CAP),
      });
      messageId = msg.message_id;
    } else if (image) {
      const msg = await this.bot.telegram.sendPhoto(this.channel, image.url, {
        caption: caption.slice(0, CAPTION_CAP),
      });
      messageId = msg.message_id;
    } else {
      // Text-only (Telegram allows it; caption cap is higher for messages).
      const msg = await this.bot.telegram.sendMessage(this.channel, caption.slice(0, 4096));
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
