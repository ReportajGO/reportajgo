// Authorization + rate limiting for the Telegram approval bot.
//
// A bot token is effectively public (the username is discoverable), so every
// update MUST be checked against a static allow-list of Telegram user IDs
// (APPROVERS env). We fail CLOSED: if no approvers are configured, nobody is
// authorized. This is the single choke point that protects approve / reject /
// publish / run-pipeline / settings from strangers.
import type { Context, MiddlewareFn } from "telegraf";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";

const log = logger.child({ module: "telegram-auth" });

// Parsed once at startup. IDs are compared as strings so "12345" == 12345.
const approverSet = new Set(env.approvers.map((a) => a.trim()).filter(Boolean));

/** True if the given Telegram user id is on the static approver allow-list. */
export function isApprover(id: number | string | undefined | null): boolean {
  if (id === undefined || id === null) return false;
  return approverSet.has(String(id));
}

/** Whether any approver is configured at all (used for a fail-closed warning). */
export function hasApprovers(): boolean {
  return approverSet.size > 0;
}

/**
 * Telegraf middleware: allow only allow-listed Telegram user IDs through.
 * Register this FIRST, before any command/action/text handler, so every update
 * is gated. Unauthorized callers get a quiet rejection and are dropped.
 */
export const requireApprover: MiddlewareFn<Context> = async (ctx, next) => {
  const uid = ctx.from?.id;
  if (isApprover(uid)) return next();

  log.warn(
    { uid, username: ctx.from?.username, updateType: ctx.updateType },
    "blocked unauthorized telegram user",
  );
  if (ctx.callbackQuery) {
    await ctx.answerCbQuery("⛔️ Not authorized", { show_alert: true }).catch(() => {});
  } else if (ctx.message) {
    await ctx.reply("⛔️ You are not authorized to use this bot.").catch(() => {});
  }
  // Deliberately do NOT call next() — the update stops here.
};

// ── per-user rate limiting for expensive actions ─────────────────────────────
// Each expensive op (instant-publish from a link, run-pipeline, publish-all)
// costs real Gemini/image spend and worker time, so cap how often a single user
// can trigger it. In-memory is fine: a single bot process handles all updates.
const lastAction = new Map<string, number>();

/**
 * Returns true if (userId, action) is being invoked again before its cooldown
 * elapsed — the caller should reject the request. Also records this invocation.
 */
export function rateLimited(
  userId: number | string | undefined,
  action: string,
  cooldownMs: number,
): boolean {
  const key = `${userId ?? "?"}:${action}`;
  const now = Date.now();
  const prev = lastAction.get(key) ?? 0;
  if (now - prev < cooldownMs) return true;
  lastAction.set(key, now);
  return false;
}
