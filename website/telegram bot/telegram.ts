// Original location: src/lib/telegram.ts
import { Bot } from "grammy";

/**
 * Telegram moderation bot — initialization & shared config.
 *
 * This module ONLY constructs the bot instance and exposes the env-derived
 * settings the rest of the integration needs (allowlist, webhook secret, the
 * moderators' chat id). Update handlers (button presses) are wired up in the
 * webhook API route; outbound notifications live in the post-creation flow.
 */

// ── Moderation status constants (mirror the Post.status String in Prisma) ──
export const PostStatus = {
  PENDING: "PENDING",
  PUBLISHED: "PUBLISHED",
  REJECTED: "REJECTED",
} as const;

export type PostStatus = (typeof PostStatus)[keyof typeof PostStatus];

// ── Environment ────────────────────────────────────────────────────────────
const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  // Fail loud at module load: a bot without a token is never useful.
  throw new Error(
    "TELEGRAM_BOT_TOKEN is not set. Add it to your .env before using the bot.",
  );
}

/** Chat where new-post notifications are delivered. */
export const MODERATION_CHAT_ID = process.env.TELEGRAM_MODERATION_CHAT_ID ?? "";

/**
 * Secret token guarding the webhook. Telegram returns it in the
 * `X-Telegram-Bot-Api-Secret-Token` header on every update, and we also embed
 * it in the webhook path — so forged requests can be rejected cheaply.
 */
export const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET ?? "";

/**
 * Telegram user IDs allowed to operate the bot, parsed from the
 * comma-separated `TELEGRAM_ALLOWED_CHAT_IDS` env var.
 */
export const ALLOWED_CHAT_IDS: ReadonlySet<number> = new Set(
  (process.env.TELEGRAM_ALLOWED_CHAT_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number)
    .filter((n) => Number.isFinite(n)),
);

/** True when the given Telegram user id is permitted to moderate. */
export function isAllowedUser(userId: number | undefined): boolean {
  if (userId === undefined) return false;
  // Empty allowlist = locked down (deny everyone) rather than open by default.
  return ALLOWED_CHAT_IDS.has(userId);
}

// ── Bot singleton ───────────────────────────────────────────────────────────
// Reuse one Bot instance across Next.js hot reloads in development, mirroring
// the PrismaClient pattern in lib/prisma.ts.
const globalForBot = globalThis as unknown as { tgBot?: Bot };

export const bot: Bot = globalForBot.tgBot ?? new Bot(token);

if (process.env.NODE_ENV !== "production") globalForBot.tgBot = bot;
