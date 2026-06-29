import { join } from "node:path";
import { Telegraf } from "telegraf";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { prisma } from "../db/client.js";
import { approveDraft, rejectDraft } from "../dashboard/approvalService.js";
import { scanNow } from "../dashboard/controlService.js";
import { MEDIA_ROOT } from "../generate/media/mediaStore.js";
import { handleControlPanelText, mainMenu, registerControlPanel } from "./controlPanel.js";
import { startWebApp } from "./webApp.js";

const log = logger.child({ module: "telegram-approval" });

const APPROVERS_KEY = "telegramApprovers";
const SWEEP_MS = 30_000;
const CAPTION_CAP = 1024;

let bot: Telegraf | undefined;

// ── approver registry (stored in the Setting table) ──────────────────────────
async function getApproverChats(): Promise<number[]> {
  const row = await prisma.setting.findUnique({ where: { key: APPROVERS_KEY } });
  if (!row) return [];
  try {
    return JSON.parse(row.value) as number[];
  } catch {
    return [];
  }
}

async function addApproverChat(chatId: number): Promise<void> {
  const chats = await getApproverChats();
  if (chats.includes(chatId)) return;
  chats.push(chatId);
  await prisma.setting.upsert({
    where: { key: APPROVERS_KEY },
    create: { key: APPROVERS_KEY, value: JSON.stringify(chats) },
    update: { value: JSON.stringify(chats) },
  });
  log.info({ chatId }, "registered telegram approver");
}

// ── message building ─────────────────────────────────────────────────────────
function escapeHtml(s: unknown): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Map a served /media/<file> URL back to its local path for upload. */
function localPathFor(url: string): string | undefined {
  const marker = "/media/";
  const idx = url.indexOf(marker);
  return idx === -1 ? undefined : join(MEDIA_ROOT, url.slice(idx + marker.length));
}

interface DraftForApproval {
  id: string;
  platform: string;
  language: string;
  headline: string | null;
  body: string;
  hashtags: string[];
  newsItem: { sourceName: string | null; sourceUrl: string } | null;
  media: { type: string; url: string }[];
}

function buildCaption(draft: DraftForApproval): string {
  const lines: string[] = [];
  if (draft.headline) lines.push(`📰 <b>${escapeHtml(draft.headline)}</b>`);
  lines.push(`<i>${escapeHtml(draft.platform)} · ${escapeHtml(draft.language)}</i>`, "");
  lines.push(escapeHtml(draft.body));
  if (draft.hashtags.length) lines.push("", escapeHtml(draft.hashtags.map((h) => `#${h}`).join(" ")));
  if (draft.newsItem?.sourceName) lines.push("", `— ${escapeHtml(draft.newsItem.sourceName)}`);
  let caption = lines.join("\n");
  if (caption.length > CAPTION_CAP) caption = `${caption.slice(0, CAPTION_CAP - 1)}…`;
  return caption;
}

function keyboard(draftId: string) {
  return {
    inline_keyboard: [
      [
        { text: "✅ Approve", callback_data: `ap:${draftId}` },
        { text: "❌ Reject", callback_data: `rj:${draftId}` },
      ],
      [{ text: "⚡ Publish now", callback_data: `pn:${draftId}` }],
    ],
  };
}

async function sendApprovalMessage(chatId: number, draft: DraftForApproval): Promise<void> {
  if (!bot) return;
  const caption = buildCaption(draft);
  const image = draft.media.find((m) => m.type === "IMAGE");
  if (image) {
    const path = localPathFor(image.url);
    await bot.telegram.sendPhoto(chatId, path ? { source: path } : image.url, {
      caption,
      parse_mode: "HTML",
      reply_markup: keyboard(draft.id),
    });
  } else {
    await bot.telegram.sendMessage(chatId, caption, {
      parse_mode: "HTML",
      reply_markup: keyboard(draft.id),
    });
  }
}

// ── periodic sweep: push un-sent ready drafts to approvers ───────────────────
async function sweep(): Promise<void> {
  const approvers = await getApproverChats();
  if (approvers.length === 0) return;

  const drafts = (await prisma.postDraft.findMany({
    where: { status: "PENDING_APPROVAL", approvalSentAt: null },
    include: {
      media: { where: { status: "READY" }, select: { type: true, url: true } },
      newsItem: { select: { sourceName: true, sourceUrl: true } },
    },
    orderBy: { createdAt: "asc" },
    take: 30,
  })) as unknown as (DraftForApproval & { newsItemId: string })[];

  // One approval card per news item — prefer the TELEGRAM preview. Approving it
  // cascades to the other platforms (e.g. the WEBSITE article) automatically.
  const byNews = new Map<string, (typeof drafts)[number]>();
  for (const d of drafts) {
    const current = byNews.get(d.newsItemId);
    if (!current || (d.platform === "TELEGRAM" && current.platform !== "TELEGRAM")) {
      byNews.set(d.newsItemId, d);
    }
  }

  for (const draft of byNews.values()) {
    if (draft.media.length === 0) continue; // media not ready yet
    try {
      for (const chat of approvers) await sendApprovalMessage(chat, draft);
      // Silence the sibling cards for this news item — they're approved together.
      await prisma.postDraft.updateMany({
        where: { newsItemId: draft.newsItemId, status: "PENDING_APPROVAL", approvalSentAt: null },
        data: { approvalSentAt: new Date() },
      });
      log.info({ draftId: draft.id, newsItemId: draft.newsItemId }, "approval message sent");
    } catch (err) {
      log.error({ err, draftId: draft.id }, "failed to send approval message");
    }
  }
}

// ── lifecycle ────────────────────────────────────────────────────────────────
/** Launch the Telegram approval bot (no-op if the token isn't set). */
export function startApprovalBot(): { stop: () => void } | undefined {
  const token = env.TELEGRAM_APPROVAL_BOT_TOKEN;
  if (!token) {
    log.warn("TELEGRAM_APPROVAL_BOT_TOKEN not set; Telegram approval disabled");
    return undefined;
  }

  bot = new Telegraf(token);

  // Control-panel handlers (cp:* callbacks + text inputs).
  registerControlPanel(bot);

  bot.start(async (ctx) => {
    await addApproverChat(ctx.chat.id);
    await ctx.reply(
      "✅ You're registered as a ReportajGO approver.\nI'll send each ready post here with Approve / Reject buttons.",
    );
    const { text, markup } = await mainMenu();
    await ctx.reply(text, { parse_mode: "HTML", ...markup });
  });

  bot.command(["menu", "panel"], async (ctx) => {
    const { text, markup } = await mainMenu();
    await ctx.reply(text, { parse_mode: "HTML", ...markup });
  });

  bot.command("ping", (ctx) => ctx.reply("pong — approval bot is live."));

  // Free-text routed to the control panel (custom cron / add topic).
  bot.on("text", async (ctx, next) => {
    const consumed = await handleControlPanelText(ctx).catch(() => false);
    if (!consumed) await next();
  });

  bot.action(/^ap:(.+)$/, async (ctx) => {
    const id = ctx.match[1]!;
    try {
      await approveDraft(id, {
        scheduledAt: new Date().toISOString(),
        approver: `tg:${ctx.from?.id ?? "unknown"}`,
      });
      await scanNow(); // publish right away (website first, then channel) — no 60s wait
      await ctx.answerCbQuery("Approved & publishing ✓");
      await ctx.editMessageReplyMarkup(undefined).catch(() => {});
      await ctx.reply("✅ Approved — publishing the website article and channel post now.");
    } catch (err) {
      await ctx.answerCbQuery(`Error: ${err instanceof Error ? err.message : "failed"}`, { show_alert: true });
    }
  });

  bot.action(/^pn:(.+)$/, async (ctx) => {
    const id = ctx.match[1]!;
    try {
      await approveDraft(id, {
        scheduledAt: new Date().toISOString(),
        approver: `tg:${ctx.from?.id ?? "unknown"}:instant`,
      });
      await scanNow(); // don't wait for the 60s scanner — publish right away
      await ctx.answerCbQuery("Publishing now ⚡");
      await ctx.editMessageReplyMarkup(undefined).catch(() => {});
      await ctx.reply("⚡ Approved & publishing now.");
    } catch (err) {
      await ctx.answerCbQuery(`Error: ${err instanceof Error ? err.message : "failed"}`, { show_alert: true });
    }
  });

  bot.action(/^rj:(.+)$/, async (ctx) => {
    const id = ctx.match[1]!;
    try {
      await rejectDraft(id, "rejected via Telegram");
      await ctx.answerCbQuery("Rejected");
      await ctx.editMessageReplyMarkup(undefined).catch(() => {});
      await ctx.reply("❌ Rejected.");
    } catch (err) {
      await ctx.answerCbQuery(`Error: ${err instanceof Error ? err.message : "failed"}`, { show_alert: true });
    }
  });

  void bot.launch().catch((err) => log.error({ err }, "approval bot launch failed"));
  const timer = setInterval(() => void sweep().catch((err) => log.error({ err }, "sweep failed")), SWEEP_MS);
  // Expose the website admin as a Telegram Mini App (menu button → cloudflared tunnel).
  const webApp = startWebApp(bot);
  log.info("telegram approval bot started");

  return {
    stop: () => {
      clearInterval(timer);
      webApp?.stop();
      bot?.stop();
    },
  };
}
