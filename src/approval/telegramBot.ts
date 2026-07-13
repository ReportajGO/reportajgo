import { join } from "node:path";
import { Telegraf } from "telegraf";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { prisma } from "../db/client.js";
import { approveDraft, rejectDraft } from "../dashboard/approvalService.js";
import { scanNow } from "../dashboard/controlService.js";
import { platformsWithoutRequiredMedia } from "../domain/platforms.js";
import { MEDIA_ROOT } from "../generate/media/mediaStore.js";
import {
  getPublishState,
  instantPostFromUrl,
  type InstantStage,
} from "../pipeline/instantPost.js";
import { handleControlPanelText, mainMenu, registerControlPanel } from "./controlPanel.js";
import { hasApprovers, isApprover, rateLimited, requireApprover } from "./auth.js";
import { startWebApp } from "./webApp.js";

// Instant-publish from a pasted link is the most expensive per-message action
// (Gemini research + drafting + image gen), so throttle it hard per user.
const INSTANT_COOLDOWN_MS = 30_000;

const log = logger.child({ module: "telegram-approval" });

const APPROVERS_KEY = "telegramApprovers";
const SWEEP_MS = 30_000;
const CAPTION_CAP = 1024;

let bot: Telegraf | undefined;

// ── approver registry (stored in the Setting table) ──────────────────────────
async function getApproverChats(): Promise<number[]> {
  const row = await prisma.setting.findUnique({ where: { key: APPROVERS_KEY } });
  const configured = env.approvers
    .map((id) => Number(id))
    .filter((id) => Number.isSafeInteger(id));
  if (!row) return configured;
  try {
    const registered = JSON.parse(row.value) as number[];
    return [...new Set([...registered, ...configured])];
  } catch {
    return configured;
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
  // Prefer the Reel video so the approver reviews the actual clip before it
  // posts; fall back to the image, then text-only.
  const video = draft.media.find((m) => m.type === "VIDEO");
  const image = draft.media.find((m) => m.type === "IMAGE");
  if (video) {
    const path = localPathFor(video.url);
    await bot.telegram.sendVideo(chatId, path ? { source: path } : video.url, {
      caption,
      parse_mode: "HTML",
      reply_markup: keyboard(draft.id),
    });
  } else if (image) {
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
  const textOnlyPlatforms = platformsWithoutRequiredMedia();

  const drafts = (await prisma.postDraft.findMany({
    where: {
      status: "PENDING_APPROVAL",
      approvalSentAt: null,
      ...(!env.MEDIA_GENERATION_ENABLED ? { platform: { in: textOnlyPlatforms } } : {}),
    },
    include: {
      media: { where: { status: "READY" }, select: { type: true, url: true } },
      newsItem: { select: { sourceName: true, sourceUrl: true } },
    },
    orderBy: { createdAt: "asc" },
    take: 30,
  })) as unknown as (DraftForApproval & { newsItemId: string })[];

  // One approval card per news item — prefer the TELEGRAM preview for the
  // headline/caption. Approving it cascades to the other platforms automatically.
  const byNews = new Map<string, (typeof drafts)[number]>();
  // Merge media across ALL of an item's drafts so the card can show the Reel
  // (on the Instagram draft) even though the TELEGRAM draft is the representative.
  const mediaByNews = new Map<string, { type: string; url: string }[]>();
  for (const d of drafts) {
    const current = byNews.get(d.newsItemId);
    if (!current || (d.platform === "TELEGRAM" && current.platform !== "TELEGRAM")) {
      byNews.set(d.newsItemId, d);
    }
    const acc = mediaByNews.get(d.newsItemId) ?? [];
    acc.push(...d.media);
    mediaByNews.set(d.newsItemId, acc);
  }

  // Send a card as soon as ANY of the item's drafts has ready media — don't wait
  // for slower siblings (e.g. the Instagram Reel video, which takes minutes). When
  // a still-rendering sibling becomes ready later it moves to PENDING_APPROVAL and
  // the next sweep sends its own follow-up card. Approving a card only schedules
  // siblings whose media is already READY (see approveDraft), so nothing publishes
  // without its media.
  for (const rep of byNews.values()) {
    const media = mediaByNews.get(rep.newsItemId) ?? [];
    if (env.MEDIA_GENERATION_ENABLED && media.length === 0) continue; // this item has no ready media yet
    // Show the Reel (video) when the item has one; keep the rep's headline/text.
    const draft = { ...rep, media };
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

// ── instant post from a link ─────────────────────────────────────────────────
const URL_RE = /https?:\/\/[^\s]+/i;
const PUBLISH_TERMINAL = new Set(["PUBLISHED", "FAILED", "CANCELLED"]);
const POLL_INTERVAL_MS = 3000;
const POLL_MAX_ATTEMPTS = 20; // ~60s for website+social to publish

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const STAGE_TEXT: Record<InstantStage, string> = {
  reading: "📖 Reading the article…",
  drafting: "✍️ Writing the posts in 3 languages…",
  media: "🖼️ Generating the images…",
  publishing: "🚀 Approving & publishing now…",
};

function firstUrl(text: string): string | undefined {
  return text.match(URL_RE)?.[0];
}

/**
 * Handle a pasted news link: build ready posts + images with the agent and
 * publish them immediately (no approval step). Edits one status message as it
 * progresses, then reports the per-platform result.
 */
async function handleInstantUrl(chatId: number, url: string, fromId: number | undefined): Promise<void> {
  if (!bot) return;

  // Only allow-listed approvers may trigger an instant publish (defense in depth
  // on top of the global auth middleware, keyed on the actual user id).
  if (!isApprover(fromId)) {
    await bot.telegram.sendMessage(chatId, "⛔️ Not authorized.");
    return;
  }
  // Throttle: instant-publish is expensive (Gemini + image gen + publish).
  if (rateLimited(fromId, "instant", INSTANT_COOLDOWN_MS)) {
    await bot.telegram.sendMessage(chatId, "⏳ Please wait a moment before sending another link.");
    return;
  }

  const status = await bot.telegram.sendMessage(chatId, "🔗 Link received. Starting…");
  const setStatus = (text: string) =>
    bot!.telegram.editMessageText(chatId, status.message_id, undefined, text).catch(() => {});

  try {
    const result = await instantPostFromUrl(url, {
      approver: `tg:${fromId ?? "unknown"}:url`,
      onProgress: (stage) => void setStatus(STAGE_TEXT[stage]),
    });

    // Poll until the publish jobs settle (website-first, then social).
    let state = await getPublishState(result.newsItemId);
    for (let i = 0; i < POLL_MAX_ATTEMPTS; i++) {
      if (state.length > 0 && state.every((s) => PUBLISH_TERMINAL.has(s.status))) break;
      await sleep(POLL_INTERVAL_MS);
      state = await getPublishState(result.newsItemId);
    }

    const published = state.filter((s) => s.status === "PUBLISHED").map((s) => s.platform);
    const failed = state.filter((s) => s.status === "FAILED");
    const pending = state.filter((s) => !PUBLISH_TERMINAL.has(s.status)).map((s) => s.platform);

    const lines = [`<b>${escapeHtml(result.title)}</b>`, ""];
    if (published.length) lines.push(`✅ Published: <b>${published.join(", ")}</b>`);
    if (pending.length) lines.push(`⏳ Still publishing: ${pending.join(", ")}`);
    if (failed.length) {
      lines.push("", "⚠️ Failed:");
      for (const f of failed) lines.push(`• ${f.platform}: ${escapeHtml(f.error ?? "unknown error")}`);
    }
    if (result.draftsFailed > 0) lines.push("", `⚠️ ${result.draftsFailed} platform(s) had no image generated.`);
    if (!published.length && !pending.length && !failed.length) lines.push("Posts created and queued.");

    await setStatus("✅ Done.");
    await bot.telegram.sendMessage(chatId, lines.join("\n"), { parse_mode: "HTML" });
    log.info({ url, newsItemId: result.newsItemId, published }, "instant url published");
  } catch (err) {
    // Don't echo raw error text to chat (can leak internal details); log it.
    await setStatus("❌ Couldn't process that link. Please try again.");
    log.error({ err, url }, "instant url failed");
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

  if (!hasApprovers()) {
    log.error(
      "APPROVERS is empty — the Telegram bot would be open to anyone. " +
        "Set APPROVERS to your Telegram user id(s); refusing to start until then.",
    );
    return undefined;
  }

  bot = new Telegraf(token);

  // AUTHORIZATION GATE — must be the first middleware so every command, action
  // and message is checked against the static approver allow-list before any
  // handler runs. Without this, anyone who finds the bot could approve/publish.
  bot.use(requireApprover);

  // Control-panel handlers (cp:* callbacks + text inputs).
  registerControlPanel(bot);

  bot.start(async (ctx) => {
    // Reaching here means the caller already passed the allow-list gate.
    await addApproverChat(ctx.chat.id);
    await ctx.reply(
      "✅ You're registered as a ReportajGO approver.\n" +
        "• I'll send each auto-researched post here with Approve / Reject buttons.\n" +
        "• Or just paste a news link and I'll build ready posts + images and publish them immediately — no approval needed.",
    );
    const { text, markup } = await mainMenu();
    await ctx.reply(text, { parse_mode: "HTML", ...markup });
  });

  bot.command(["menu", "panel"], async (ctx) => {
    const { text, markup } = await mainMenu();
    await ctx.reply(text, { parse_mode: "HTML", ...markup });
  });

  bot.command("ping", (ctx) => ctx.reply("pong — approval bot is live."));

  // Free-text routing: first the control panel (custom cron / add topic), then
  // a pasted news link → instant post, otherwise fall through.
  bot.on("text", async (ctx, next) => {
    const consumed = await handleControlPanelText(ctx).catch(() => false);
    if (consumed) return;
    const url = firstUrl(ctx.message.text ?? "");
    if (url) {
      void handleInstantUrl(ctx.chat.id, url, ctx.from?.id);
      return;
    }
    await next();
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
      log.error({ err }, "approve callback failed");
      await ctx.answerCbQuery("Something went wrong. Try again.", { show_alert: true });
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
      log.error({ err }, "publish-now callback failed");
      await ctx.answerCbQuery("Something went wrong. Try again.", { show_alert: true });
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
      log.error({ err }, "reject callback failed");
      await ctx.answerCbQuery("Something went wrong. Try again.", { show_alert: true });
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
