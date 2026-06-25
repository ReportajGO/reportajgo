// Original location: src/lib/telegram-moderation.ts
import { InlineKeyboard, type Context } from "grammy";
import { prisma } from "@/lib/prisma";
import {
  bot,
  isAllowedUser,
  MODERATION_CHAT_ID,
  PostStatus,
} from "@/lib/telegram";
import { notifyAgentDecision } from "@/lib/agentCallback";

/**
 * Telegram moderation logic: how a new post is announced to the moderators'
 * chat, and what happens when someone presses ✅ / ❌ / a schedule button.
 */

// New format: mod:ok:<id>:<when> / mod:no:<id>.
// Legacy format (older cards): mod:approve:<id> / mod:reject:<id> → treated as
// "publish now" / reject, so buttons sent before scheduling still work.
const CALLBACK_RE = /^mod:(ok|no|approve|reject):([^:]+)(?::(now|60|180|t9))?$/;

// Human-readable labels used inside the moderation card.
const LANG_LABEL: Record<string, string> = {
  uz: "🇺🇿 O‘zbek",
  ru: "🇷🇺 Русский",
  en: "🇬🇧 English",
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ── Scheduling helpers ───────────────────────────────────────────────────────
// Uzbekistan observes no DST, so Asia/Tashkent is a fixed UTC+5.
const TZ = "Asia/Tashkent";
const TZ_OFFSET_MIN = 5 * 60;

/** Format an instant as "DD.MM HH:mm" in Tashkent local time. */
export function fmtTime(d: Date): string {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: TZ,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

/** The next 09:00 Tashkent time strictly after `now`. */
function tomorrowMorning(now: Date): Date {
  const shifted = new Date(now.getTime() + TZ_OFFSET_MIN * 60_000);
  shifted.setUTCDate(shifted.getUTCDate() + 1);
  shifted.setUTCHours(9, 0, 0, 0);
  return new Date(shifted.getTime() - TZ_OFFSET_MIN * 60_000);
}

/**
 * Resolve a schedule token from the inline button into a concrete go-live time.
 * Returns null for "publish now" (no scheduling).
 */
function resolvePublishAt(token: string | undefined, now: Date): Date | null {
  switch (token) {
    case "60":
      return new Date(now.getTime() + 60 * 60_000);
    case "180":
      return new Date(now.getTime() + 180 * 60_000);
    case "t9":
      return tomorrowMorning(now);
    case "now":
    default:
      return null;
  }
}

type ModerationPost = {
  id: string;
  title: string;
  excerpt: string;
  language: string;
  category: { slug: string };
  publishAt?: Date | null;
};

/** The notification card body (without the status footer / buttons). */
function buildCardText(post: ModerationPost): string {
  const lang = LANG_LABEL[post.language] ?? post.language;
  const lines = [
    "🆕 <b>Новая новость на модерации</b>",
    "",
    `📰 <b>Заголовок:</b> ${escapeHtml(post.title)}`,
    `🌐 <b>Язык:</b> ${lang}`,
    `🗂 <b>Категория:</b> ${escapeHtml(post.category.slug)}`,
  ];
  // Surface a time the agent proposed, so the moderator can just confirm it.
  if (post.publishAt) {
    lines.push(`⏰ <b>Предложено к публикации:</b> ${fmtTime(post.publishAt)}`);
  }
  lines.push("", "📝 <b>Краткое содержание:</b>", escapeHtml(post.excerpt));
  return lines.join("\n");
}

/**
 * Inline keyboard: the moderator both decides AND picks the go-live time in one
 * tap. callback_data is `mod:ok:<id>:<when>` (when ∈ now|60|180|t9) or
 * `mod:no:<id>` — all well within Telegram's 64-byte limit for cuid ids.
 */
function moderationKeyboard(postId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("✅ Сейчас", `mod:ok:${postId}:now`)
    .text("🕐 +1ч", `mod:ok:${postId}:60`)
    .text("🕐 +3ч", `mod:ok:${postId}:180`)
    .row()
    .text("🌅 Завтра 09:00", `mod:ok:${postId}:t9`)
    .text("❌ Отклонить", `mod:no:${postId}`);
}

/**
 * Send the moderation card for a freshly created (PENDING) post to the
 * moderators' chat. Returns the chat/message ids so the caller can persist them.
 *
 * Throws if no moderation chat is configured; callers should catch so that a
 * Telegram outage never blocks article creation.
 */
export async function notifyNewPost(
  post: ModerationPost,
): Promise<{ chatId: string; messageId: number }> {
  if (!MODERATION_CHAT_ID) {
    throw new Error("TELEGRAM_MODERATION_CHAT_ID is not configured.");
  }

  const sent = await bot.api.sendMessage(MODERATION_CHAT_ID, buildCardText(post), {
    parse_mode: "HTML",
    reply_markup: moderationKeyboard(post.id),
    link_preview_options: { is_disabled: true },
  });

  return { chatId: String(sent.chat.id), messageId: sent.message_id };
}

/** Replace the buttons with a final status line on the original message. */
async function finalizeCard(ctx: Context, footer: string): Promise<void> {
  const original = ctx.callbackQuery?.message?.text ?? "";
  const base = original.length ? `${escapeHtml(original)}\n\n` : "";
  await ctx.editMessageText(`${base}${footer}`, {
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: [] }, // drop the buttons
  });
}

let registered = false;

/**
 * Wire the ✅ / ❌ / schedule callback handlers onto the shared bot instance.
 * Idempotent — safe to call on every webhook invocation / hot reload.
 */
export function registerModerationHandlers(): void {
  if (registered) return;
  registered = true;

  bot.callbackQuery(CALLBACK_RE, async (ctx) => {
    // 1) Authorization — only allow-listed Telegram users may moderate.
    if (!isAllowedUser(ctx.from?.id)) {
      await ctx.answerCallbackQuery({
        text: "⛔ У вас нет прав на модерацию.",
        show_alert: true,
      });
      return;
    }

    const match = ctx.callbackQuery.data.match(CALLBACK_RE);
    if (!match) {
      await ctx.answerCallbackQuery();
      return;
    }
    const [, action, postId, token] = match;
    const isApprove = action === "ok" || action === "approve";

    // 2) Load the post and guard against double-processing / stale buttons.
    const post = await prisma.post.findUnique({ where: { id: postId } });
    if (!post) {
      await ctx.answerCallbackQuery({ text: "Новость не найдена.", show_alert: true });
      await finalizeCard(ctx, "status: ⚪️ Новость удалена");
      return;
    }
    if (post.status !== PostStatus.PENDING) {
      await ctx.answerCallbackQuery({
        text: "Эта новость уже обработана.",
        show_alert: true,
      });
      return;
    }

    // 3) Apply the decision.
    const who = ctx.from?.username
      ? `@${ctx.from.username}`
      : escapeHtml(ctx.from?.first_name ?? "moderator");

    if (isApprove) {
      const now = new Date();
      const publishAt = resolvePublishAt(token, now); // null = publish now
      const scheduled = publishAt !== null;

      const updated = await prisma.post.update({
        where: { id: postId },
        data: {
          status: PostStatus.PUBLISHED,
          // Hidden from the site until go-live when scheduled; the public query
          // gates on publishAt, so it surfaces automatically at that time.
          published: !scheduled,
          approvedAt: now,
          publishAt, // null = live now, future Date = scheduled
        },
        include: { category: true },
      });

      await ctx.answerCallbackQuery({
        text: scheduled ? `🕐 Запланировано на ${fmtTime(publishAt)}` : "✅ Опубликовано",
      });
      await finalizeCard(
        ctx,
        scheduled
          ? `status: 🟡 Запланировано на ${fmtTime(publishAt)} (Модератор: ${who})`
          : `status: 🟢 Одобрено (Модератор: ${who})`,
      );
      // Notify the AI agent so it can cross-post (now, or at the scheduled time).
      await notifyAgentDecision({ ...updated, category: updated.category.slug });
    } else {
      const updated = await prisma.post.update({
        where: { id: postId },
        data: { status: PostStatus.REJECTED, published: false },
        include: { category: true },
      });
      await ctx.answerCallbackQuery({ text: "❌ Отклонено" });
      await finalizeCard(ctx, `status: 🔴 Отклонено (Модератор: ${who})`);
      await notifyAgentDecision({ ...updated, category: updated.category.slug });
    }
  });

  // Ignore any other update type quietly (commands, plain messages, etc.).
  bot.on("callback_query:data", (ctx) => ctx.answerCallbackQuery());
}
