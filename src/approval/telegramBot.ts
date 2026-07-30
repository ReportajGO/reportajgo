import { existsSync } from "node:fs";
import { join } from "node:path";
import { Telegraf } from "telegraf";
import type { InputMediaPhoto, InputMediaVideo } from "telegraf/types";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { prisma } from "../db/client.js";
import { approveDraft, rejectDraft } from "../dashboard/approvalService.js";
import { scanNow } from "../dashboard/controlService.js";
import { platformsWithoutRequiredMedia, profileFor } from "../domain/platforms.js";
import { isNewsPriority } from "../domain/priority.js";
import type { NewsPriority, Platform } from "../domain/types.js";
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

/**
 * Map a served /media/<file> URL back to its local path for upload — but only
 * when that file actually exists on disk. Media now lives on S3, whose URLs also
 * contain "/media/"; without the existence check we'd rewrite an S3 URL to a
 * bogus local path and crash telegraf with ENOENT (which silently killed the
 * approval cards). Returning undefined makes the caller send Telegram the public
 * URL directly.
 */
function localPathFor(url: string): string | undefined {
  const marker = "/media/";
  const idx = url.indexOf(marker);
  if (idx === -1) return undefined;
  const path = join(MEDIA_ROOT, url.slice(idx + marker.length));
  return existsSync(path) ? path : undefined;
}

/** Telegram accepts a local file ({ source }) or a public URL string. */
function mediaSource(url: string): { source: string } | string {
  const path = localPathFor(url);
  return path ? { source: path } : url;
}

interface DraftForApproval {
  id: string;
  platform: string;
  language: string;
  headline: string | null;
  body: string;
  hashtags: string[];
  newsItem: { sourceName: string | null; sourceUrl: string; priority?: string | null } | null;
  media: { type: string; url: string }[];
}

/** A prominent tag for notable stories only (breaking/high); null otherwise. */
function priorityTag(priority: string | null | undefined): string | null {
  if (!isNewsPriority(priority)) return null;
  if (priority === "BREAKING") return "🔴 <b>BREAKING</b>";
  if (priority === "HIGH") return "🟠 <b>HIGH PRIORITY</b>";
  return null;
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

// One approvable unit = a news item and all its per-platform drafts (grouped by
// newsItemId). Approving/rejecting acts on the whole group.
interface NewsGroup {
  newsItemId: string;
  headline: string | null;
  priority: NewsPriority | null; // editorial level, for the badge
  caption: string; // the website copy, used as the single album caption
  media: { type: string; url: string }[]; // every platform's READY media, deduped
  platforms: string[]; // distinct target platforms (for the controls summary)
}

/** Group-card caption: the website copy (clean — no per-platform line). */
function buildGroupCaption(input: {
  headline: string | null;
  body: string;
  hashtags: string[];
  sourceName: string | null;
  priority?: string | null;
}): string {
  const lines: string[] = [];
  const tag = priorityTag(input.priority);
  if (tag) lines.push(tag, "");
  if (input.headline) lines.push(`📰 <b>${escapeHtml(input.headline)}</b>`, "");
  lines.push(escapeHtml(input.body));
  if (input.hashtags.length)
    lines.push("", escapeHtml(input.hashtags.map((h) => `#${h}`).join(" ")));
  if (input.sourceName) lines.push("", `— ${escapeHtml(input.sourceName)}`);
  let caption = lines.join("\n");
  if (caption.length > CAPTION_CAP) caption = `${caption.slice(0, CAPTION_CAP - 1)}…`;
  return caption;
}

/** Group controls: one Approve/Reject for the whole story + Expand. Keyed on newsItemId. */
function groupKeyboard(newsItemId: string) {
  return {
    inline_keyboard: [
      [
        { text: "✅ Approve", callback_data: `apg:${newsItemId}` },
        { text: "❌ Reject", callback_data: `rjg:${newsItemId}` },
      ],
      [{ text: "🔎 Expand (per platform)", callback_data: `exp:${newsItemId}` }],
    ],
  };
}

const ALBUM_MAX = 10; // Telegram media-group hard limit.

/** Build a Telegram media group; the caption rides on the first item only. */
function albumItems(
  media: { type: string; url: string }[],
  caption: string,
): (InputMediaPhoto | InputMediaVideo)[] {
  return media.slice(0, ALBUM_MAX).map((m, i) => {
    const head = i === 0 ? { caption, parse_mode: "HTML" as const } : {};
    return m.type === "VIDEO"
      ? ({ type: "video", media: mediaSource(m.url), ...head } as InputMediaVideo)
      : ({ type: "photo", media: mediaSource(m.url), ...head } as InputMediaPhoto);
  });
}

/**
 * Send ONE grouped approval card for a news item: the website copy as the single
 * caption plus every platform's photo as an album. Telegram albums can't carry
 * inline buttons, so ≥2 photos post as an album followed by a compact controls
 * message; 0–1 media collapse into a single captioned message that holds the
 * buttons directly.
 */
async function sendGroupApprovalCard(chatId: number, g: NewsGroup): Promise<void> {
  if (!bot) return;
  const controls = groupKeyboard(g.newsItemId);
  const media = g.media.slice(0, ALBUM_MAX);

  if (media.length >= 2) {
    await bot.telegram.sendMediaGroup(chatId, albumItems(media, g.caption));
    const tag = priorityTag(g.priority);
    const summary = [
      ...(tag ? [tag] : []),
      g.headline ? `📰 <b>${escapeHtml(g.headline)}</b>` : "Review &amp; approve",
      `🖼️ ${media.length} photos · 🌐 ${escapeHtml(g.platforms.join(", "))}`,
    ].join("\n");
    await bot.telegram.sendMessage(chatId, summary, { parse_mode: "HTML", reply_markup: controls });
    return;
  }
  const only = media[0];
  if (only) {
    const src = mediaSource(only.url);
    const extra = { caption: g.caption, parse_mode: "HTML" as const, reply_markup: controls };
    if (only.type === "VIDEO") await bot.telegram.sendVideo(chatId, src, extra);
    else await bot.telegram.sendPhoto(chatId, src, extra);
    return;
  }
  await bot.telegram.sendMessage(chatId, g.caption, { parse_mode: "HTML", reply_markup: controls });
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
      newsItem: { select: { sourceName: true, sourceUrl: true, priority: true } },
    },
    orderBy: { createdAt: "asc" },
    take: 60,
  })) as unknown as (DraftForApproval & { newsItemId: string })[];

  // One card per news item: group its per-platform drafts by newsItemId.
  const groups = new Map<string, (typeof drafts)[number][]>();
  for (const d of drafts) {
    const arr = groups.get(d.newsItemId) ?? [];
    arr.push(d);
    groups.set(d.newsItemId, arr);
  }

  for (const [newsItemId, siblings] of groups) {
    // Caption from the WEBSITE copy; fall back to any text-capable sibling, then
    // to the first draft. Website/Telegram are mediaRequired:false so the caption
    // always renders even when an image is still (or never) generating.
    const captionDraft =
      siblings.find((d) => d.platform === "WEBSITE") ??
      siblings.find((d) => !profileFor(d.platform as Platform).mediaRequired) ??
      siblings[0]!;

    // Every platform's READY media, de-duplicated by URL, for the album.
    const seen = new Set<string>();
    const media: { type: string; url: string }[] = [];
    for (const d of siblings) {
      for (const m of d.media) {
        if (seen.has(m.url)) continue;
        seen.add(m.url);
        media.push(m);
      }
    }

    const priority = isNewsPriority(captionDraft.newsItem?.priority)
      ? captionDraft.newsItem.priority
      : null;
    const group: NewsGroup = {
      newsItemId,
      headline: captionDraft.headline,
      priority,
      caption: buildGroupCaption({
        headline: captionDraft.headline,
        body: captionDraft.body,
        hashtags: captionDraft.hashtags,
        sourceName: captionDraft.newsItem?.sourceName ?? null,
        priority,
      }),
      media,
      platforms: [...new Set(siblings.map((d) => d.platform))],
    };

    try {
      for (const chat of approvers) await sendGroupApprovalCard(chat, group);
      // Silence the sibling cards for this news item — approved together as a group.
      await prisma.postDraft.updateMany({
        where: { newsItemId, status: "PENDING_APPROVAL", approvalSentAt: null },
        data: { approvalSentAt: new Date() },
      });
      log.info(
        { newsItemId, platforms: group.platforms, media: media.length },
        "group approval card sent",
      );
    } catch (err) {
      log.error({ err, newsItemId }, "failed to send group approval card");
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
      "✅ You're registered as a ReportageGO approver.\n" +
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
        spaced: true, // queue at the next free 15-min slot (drip feed)
        approver: `tg:${ctx.from?.id ?? "unknown"}`,
      });
      await scanNow(); // publish the first/due slot right away — no 60s wait
      await ctx.answerCbQuery("Approved & queued ✓");
      await ctx.editMessageReplyMarkup(undefined).catch(() => {});
      await ctx.reply("✅ Approved — queued to publish (auto-spaced every 15 min).");
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

  // ── grouped-card actions (keyed on newsItemId) ─────────────────────────────
  // Approve the whole story: approveDraft cascades to every ready sibling.
  bot.action(/^apg:(.+)$/, async (ctx) => {
    const newsItemId = ctx.match[1]!;
    try {
      const rep = await prisma.postDraft.findFirst({
        where: { newsItemId, status: "PENDING_APPROVAL" },
        select: { id: true },
      });
      if (!rep) {
        await ctx.answerCbQuery("Already handled or not ready yet.", { show_alert: true });
        return;
      }
      await approveDraft(rep.id, {
        spaced: true, // queue at the next free 15-min slot (drip feed)
        approver: `tg:${ctx.from?.id ?? "unknown"}`,
      });
      await scanNow(); // publish the first/due slot right away — no 60s wait
      await ctx.answerCbQuery("Approved & queued ✓");
      await ctx.editMessageReplyMarkup(undefined).catch(() => {});
      await ctx.reply("✅ Approved — queued to publish (auto-spaced every 15 min).");
    } catch (err) {
      log.error({ err }, "group approve callback failed");
      await ctx.answerCbQuery("Something went wrong. Try again.", { show_alert: true });
    }
  });

  // Reject the whole story: every pending sibling → REJECTED.
  bot.action(/^rjg:(.+)$/, async (ctx) => {
    const newsItemId = ctx.match[1]!;
    try {
      const res = await prisma.postDraft.updateMany({
        where: { newsItemId, status: { in: ["PENDING_APPROVAL", "PENDING_MEDIA"] } },
        data: { status: "REJECTED", rejectedReason: "rejected via Telegram (group)" },
      });
      await ctx.answerCbQuery(`Rejected ${res.count} post(s).`);
      await ctx.editMessageReplyMarkup(undefined).catch(() => {});
      await ctx.reply("❌ Rejected the whole story.");
    } catch (err) {
      log.error({ err }, "group reject callback failed");
      await ctx.answerCbQuery("Something went wrong. Try again.", { show_alert: true });
    }
  });

  // Expand: post each platform's own caption + its media so the operator can
  // review every variant before approving the group.
  bot.action(/^exp:(.+)$/, async (ctx) => {
    const newsItemId = ctx.match[1]!;
    const chatId = ctx.chat?.id;
    if (!bot || !chatId) return;
    try {
      const drafts = (await prisma.postDraft.findMany({
        where: { newsItemId, status: { in: ["PENDING_APPROVAL", "PENDING_MEDIA", "SCHEDULED"] } },
        include: {
          media: { where: { status: "READY" }, select: { type: true, url: true } },
          newsItem: { select: { sourceName: true, sourceUrl: true } },
        },
        orderBy: { platform: "asc" },
      })) as unknown as DraftForApproval[];
      if (drafts.length === 0) {
        await ctx.answerCbQuery("Nothing to expand.");
        return;
      }
      await ctx.answerCbQuery("Expanding…");
      for (const d of drafts) {
        const caption = buildCaption(d);
        const media =
          d.media.find((m) => m.type === "VIDEO") ?? d.media.find((m) => m.type === "IMAGE");
        if (media) {
          const src = mediaSource(media.url);
          if (media.type === "VIDEO")
            await bot.telegram.sendVideo(chatId, src, { caption, parse_mode: "HTML" });
          else await bot.telegram.sendPhoto(chatId, src, { caption, parse_mode: "HTML" });
        } else {
          await bot.telegram.sendMessage(chatId, caption, { parse_mode: "HTML" });
        }
      }
    } catch (err) {
      log.error({ err }, "expand callback failed");
      await ctx.answerCbQuery("Couldn't expand. Try again.", { show_alert: true });
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
