import type { Context, Telegraf } from "telegraf";
import { Markup } from "telegraf";
import { logger } from "../config/logger.js";
import {
  getRuntimeConfig,
  updateRuntimeConfig,
  VALID_PLATFORMS,
} from "../config/settingsStore.js";
import { getStatus, publishAllPending, runPipelineNow } from "../dashboard/controlService.js";
import {
  isResearchCronActive,
  pauseResearchCron,
  reRegisterResearchCron,
  resumeResearchCron,
} from "../queue/schedule.js";

const log = logger.child({ module: "control-panel" });

const GEMINI_MODELS = ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash"];
const LANGS: { code: string; label: string }[] = [
  { code: "uz", label: "Uzbek" },
  { code: "ru", label: "Russian" },
  { code: "en", label: "English" },
];
const CRON_PRESETS: { label: string; pattern: string }[] = [
  { label: "Every 1h", pattern: "0 * * * *" },
  { label: "Every 2h", pattern: "0 */2 * * *" },
  { label: "Every 4h", pattern: "0 */4 * * *" },
  { label: "Every 6h", pattern: "0 */6 * * *" },
  { label: "Twice daily", pattern: "0 9,18 * * *" },
  { label: "Daily 09:00", pattern: "0 9 * * *" },
];

// chatId -> which value we're waiting for them to type next.
const pending = new Map<number, "cron" | "topic">();

// ── helpers ──────────────────────────────────────────────────────────────────
async function applySettings(patch: Record<string, unknown>): Promise<void> {
  const { config, changedCron } = await updateRuntimeConfig(patch);
  if (changedCron && (await isResearchCronActive())) {
    await reRegisterResearchCron(config.researchCron);
  }
}

async function safeEdit(ctx: Context, text: string, markup: unknown): Promise<void> {
  try {
    await ctx.editMessageText(text, { parse_mode: "HTML", ...(markup as object) });
  } catch {
    // "message is not modified" or non-text message — send fresh instead.
    await ctx.reply(text, { parse_mode: "HTML", ...(markup as object) });
  }
}

// ── main menu ────────────────────────────────────────────────────────────────
export async function mainMenu(): Promise<{ text: string; markup: ReturnType<typeof Markup.inlineKeyboard> }> {
  const cfg = await getRuntimeConfig();
  const active = await isResearchCronActive();
  const text =
    `🤖 <b>ReportajGO — Control Panel</b>\n\n` +
    `Auto-research: <b>${active ? `ON · ${cfg.researchCron}` : "PAUSED"}</b>\n` +
    `Auto-publish: <b>${cfg.autoPublish ? "ON — posts itself, no approval" : "OFF — approve first"}</b>\n` +
    `Limit: <b>${cfg.maxItemsPerRun}/run</b> · Freshness: <b>${cfg.researchMaxAgeHours}h</b>\n` +
    `Model: <b>${cfg.geminiModel}</b>\n` +
    `Languages: <b>${cfg.contentLanguages.join(", ")}</b>`;
  const markup = Markup.inlineKeyboard([
    [Markup.button.callback("⏰ Schedule", "cp:schedule"), Markup.button.callback(`🔢 Limit (${cfg.maxItemsPerRun})`, "cp:limit")],
    [Markup.button.callback(`🔍 Freshness (${cfg.researchMaxAgeHours}h)`, "cp:freshness"), Markup.button.callback("🧠 AI model", "cp:model")],
    [Markup.button.callback("📁 Topics", "cp:topics"), Markup.button.callback("🌐 Languages", "cp:langs")],
    [Markup.button.callback("📱 Platforms", "cp:platforms"), Markup.button.callback("📊 Status", "cp:status")],
    [Markup.button.callback(active ? "⏸️ Pause auto-research" : "▶️ Resume auto-research", "cp:togglecron")],
    [Markup.button.callback(cfg.autoPublish ? "🤖 Auto-publish: ON" : "🤖 Auto-publish: OFF", "cp:toggleauto")],
    [Markup.button.callback("🔥 Run pipeline now", "cp:run")],
    [Markup.button.callback("🚀 Publish all pending", "cp:publishall")],
  ]);
  return { text, markup };
}

function backRow() {
  return [Markup.button.callback("⬅️ Back", "cp:home")];
}

// ── register handlers ────────────────────────────────────────────────────────
export function registerControlPanel(bot: Telegraf): void {
  bot.action("cp:home", async (ctx) => {
    const { text, markup } = await mainMenu();
    await ctx.answerCbQuery().catch(() => {});
    await safeEdit(ctx, text, markup);
  });

  // Schedule
  bot.action("cp:schedule", async (ctx) => {
    const cfg = await getRuntimeConfig();
    await ctx.answerCbQuery().catch(() => {});
    const rows = [];
    for (let i = 0; i < CRON_PRESETS.length; i += 2) {
      rows.push(
        CRON_PRESETS.slice(i, i + 2).map((p) => Markup.button.callback(p.label, `cp:setcron:${p.pattern}`)),
      );
    }
    rows.push([Markup.button.callback("✏️ Custom cron", "cp:promptcron")]);
    rows.push(backRow());
    await safeEdit(ctx, `⏰ <b>Schedule</b>\nCurrent: <code>${cfg.researchCron}</code>`, Markup.inlineKeyboard(rows));
  });

  bot.action(/^cp:setcron:(.+)$/, async (ctx) => {
    await applySettings({ researchCron: ctx.match[1] });
    await ctx.answerCbQuery("Schedule updated ✓").catch(() => {});
    const { text, markup } = await mainMenu();
    await safeEdit(ctx, text, markup);
  });

  bot.action("cp:promptcron", async (ctx) => {
    pending.set(ctx.chat!.id, "cron");
    await ctx.answerCbQuery().catch(() => {});
    await ctx.reply("✏️ Send a custom 5-field cron (e.g. <code>0 */3 * * *</code>):", { parse_mode: "HTML" });
  });

  // Limit
  bot.action("cp:limit", async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const opts = [3, 5, 8, 10, 15];
    await safeEdit(
      ctx,
      "🔢 <b>Posts per run</b>\nHow many top stories to draft each cycle:",
      Markup.inlineKeyboard([opts.map((n) => Markup.button.callback(String(n), `cp:setlimit:${n}`)), backRow()]),
    );
  });
  bot.action(/^cp:setlimit:(\d+)$/, async (ctx) => {
    await applySettings({ maxItemsPerRun: Number(ctx.match[1]) });
    await ctx.answerCbQuery("Limit updated ✓").catch(() => {});
    const { text, markup } = await mainMenu();
    await safeEdit(ctx, text, markup);
  });

  // Freshness
  bot.action("cp:freshness", async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const opts = [6, 12, 24, 48];
    await safeEdit(
      ctx,
      "🔍 <b>Freshness window</b>\nOnly research news from the last N hours:",
      Markup.inlineKeyboard([opts.map((n) => Markup.button.callback(`${n}h`, `cp:setfresh:${n}`)), backRow()]),
    );
  });
  bot.action(/^cp:setfresh:(\d+)$/, async (ctx) => {
    await applySettings({ researchMaxAgeHours: Number(ctx.match[1]) });
    await ctx.answerCbQuery("Freshness updated ✓").catch(() => {});
    const { text, markup } = await mainMenu();
    await safeEdit(ctx, text, markup);
  });

  // Model
  bot.action("cp:model", async (ctx) => {
    const cfg = await getRuntimeConfig();
    await ctx.answerCbQuery().catch(() => {});
    const rows = GEMINI_MODELS.map((m) => [
      Markup.button.callback(`${m === cfg.geminiModel ? "✅ " : ""}${m}`, `cp:setmodel:${m}`),
    ]);
    rows.push(backRow());
    await safeEdit(ctx, "🧠 <b>AI model</b> (research + copy):", Markup.inlineKeyboard(rows));
  });
  bot.action(/^cp:setmodel:(.+)$/, async (ctx) => {
    await applySettings({ geminiModel: ctx.match[1] });
    await ctx.answerCbQuery("Model updated ✓").catch(() => {});
    const { text, markup } = await mainMenu();
    await safeEdit(ctx, text, markup);
  });

  // Languages (toggle)
  bot.action("cp:langs", async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    await safeEdit(ctx, "🌐 <b>Content languages</b> (first = primary):", await langsMarkup());
  });
  bot.action(/^cp:togglelang:(\w+)$/, async (ctx) => {
    const cfg = await getRuntimeConfig();
    const code = ctx.match[1]!;
    const set = new Set(cfg.contentLanguages);
    if (set.has(code)) set.delete(code);
    else set.add(code);
    if (set.size === 0) {
      await ctx.answerCbQuery("Keep at least one language", { show_alert: true }).catch(() => {});
      return;
    }
    await applySettings({ contentLanguages: [...set] });
    await ctx.answerCbQuery("Updated ✓").catch(() => {});
    await safeEdit(ctx, "🌐 <b>Content languages</b> (first = primary):", await langsMarkup());
  });

  // Platforms (toggle)
  bot.action("cp:platforms", async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    await safeEdit(ctx, "📱 <b>Enabled platforms</b>:", await platformsMarkup());
  });
  bot.action(/^cp:toggleplat:(\w+)$/, async (ctx) => {
    const cfg = await getRuntimeConfig();
    const p = ctx.match[1]!;
    const set = new Set(cfg.enabledPlatforms);
    if (set.has(p as never)) set.delete(p as never);
    else set.add(p as never);
    if (set.size === 0) {
      await ctx.answerCbQuery("Keep at least one platform", { show_alert: true }).catch(() => {});
      return;
    }
    await applySettings({ enabledPlatforms: [...set] });
    await ctx.answerCbQuery("Updated ✓").catch(() => {});
    await safeEdit(ctx, "📱 <b>Enabled platforms</b>:", await platformsMarkup());
  });

  // Topics (list + add/remove)
  bot.action("cp:topics", async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    await safeEdit(ctx, await topicsText(), await topicsMarkup());
  });
  bot.action(/^cp:rmtopic:(\d+)$/, async (ctx) => {
    const cfg = await getRuntimeConfig();
    const idx = Number(ctx.match[1]);
    if (cfg.researchTopics.length <= 1) {
      await ctx.answerCbQuery("Keep at least one topic", { show_alert: true }).catch(() => {});
      return;
    }
    const next = cfg.researchTopics.filter((_, i) => i !== idx);
    await applySettings({ researchTopics: next });
    await ctx.answerCbQuery("Removed ✓").catch(() => {});
    await safeEdit(ctx, await topicsText(), await topicsMarkup());
  });
  bot.action("cp:prompttopic", async (ctx) => {
    pending.set(ctx.chat!.id, "topic");
    await ctx.answerCbQuery().catch(() => {});
    await ctx.reply("➕ Send a topic to research (e.g. <i>Global technology news</i>):", { parse_mode: "HTML" });
  });

  // Status
  bot.action("cp:status", async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    await safeEdit(ctx, await statusText(), Markup.inlineKeyboard([backRow()]));
  });

  // Auto-publish toggle (share itself — no approval)
  bot.action("cp:toggleauto", async (ctx) => {
    const cfg = await getRuntimeConfig();
    await applySettings({ autoPublish: !cfg.autoPublish });
    await ctx.answerCbQuery(cfg.autoPublish ? "Auto-publish OFF" : "Auto-publish ON 🤖").catch(() => {});
    const { text, markup } = await mainMenu();
    await safeEdit(ctx, text, markup);
  });

  // Pause / Resume
  bot.action("cp:togglecron", async (ctx) => {
    if (await isResearchCronActive()) await pauseResearchCron();
    else await resumeResearchCron();
    await ctx.answerCbQuery("Toggled ✓").catch(() => {});
    const { text, markup } = await mainMenu();
    await safeEdit(ctx, text, markup);
  });

  // Force scan / run
  bot.action("cp:run", async (ctx) => {
    try {
      const { jobId } = await runPipelineNow();
      await ctx.answerCbQuery("Pipeline started 🔥").catch(() => {});
      await ctx.reply(`🔥 Research run queued (job ${jobId}). New posts will arrive here for approval.`);
    } catch (err) {
      await ctx.answerCbQuery(`Error: ${err instanceof Error ? err.message : "failed"}`, { show_alert: true }).catch(() => {});
    }
  });

  // Publish everything pending at once (skip per-item approval)
  bot.action("cp:publishall", async (ctx) => {
    try {
      await ctx.answerCbQuery("Publishing all… 🚀").catch(() => {});
      const { items, skipped } = await publishAllPending(`tg:${ctx.from?.id ?? "unknown"}:all`);
      const msg =
        items === 0
          ? "ℹ️ Nothing pending to publish."
          : `🚀 Publishing <b>${items}</b> pending stor${items === 1 ? "y" : "ies"} across all platforms now.` +
            (skipped > 0 ? `\n⚠️ ${skipped} draft(s) skipped (no ready image yet).` : "");
      await ctx.reply(msg, { parse_mode: "HTML" });
    } catch (err) {
      await ctx.answerCbQuery(`Error: ${err instanceof Error ? err.message : "failed"}`, { show_alert: true }).catch(() => {});
    }
  });

  log.info("control panel handlers registered");
}

/** Handle a free-text message if we're waiting for a settings value. Returns true if consumed. */
export async function handleControlPanelText(ctx: Context): Promise<boolean> {
  const chatId = ctx.chat?.id;
  const text = (ctx.message as { text?: string } | undefined)?.text?.trim();
  if (!chatId || !text) return false;
  const field = pending.get(chatId);
  if (!field) return false;
  pending.delete(chatId);

  try {
    if (field === "cron") {
      if (!/^\S+\s+\S+\s+\S+\s+\S+\s+\S+$/.test(text)) {
        await ctx.reply("❌ That's not a 5-field cron. Try again from ⏰ Schedule.");
        return true;
      }
      await applySettings({ researchCron: text });
      await ctx.reply(`✅ Schedule set to <code>${text}</code>`, { parse_mode: "HTML" });
    } else if (field === "topic") {
      const cfg = await getRuntimeConfig();
      await applySettings({ researchTopics: [...cfg.researchTopics, text] });
      await ctx.reply(`✅ Topic added: <b>${escapeHtml(text)}</b>`, { parse_mode: "HTML" });
    }
    const { text: menuText, markup } = await mainMenu();
    await ctx.reply(menuText, { parse_mode: "HTML", ...markup });
  } catch (err) {
    await ctx.reply(`❌ ${err instanceof Error ? err.message : "failed to save"}`);
  }
  return true;
}

// ── submenu builders ─────────────────────────────────────────────────────────
async function langsMarkup() {
  const cfg = await getRuntimeConfig();
  const rows = LANGS.map((l) => [
    Markup.button.callback(`${cfg.contentLanguages.includes(l.code) ? "✅" : "⬜"} ${l.label}`, `cp:togglelang:${l.code}`),
  ]);
  rows.push(backRow());
  return Markup.inlineKeyboard(rows);
}

async function platformsMarkup() {
  const cfg = await getRuntimeConfig();
  const rows = VALID_PLATFORMS.map((p) => [
    Markup.button.callback(`${cfg.enabledPlatforms.includes(p) ? "✅" : "⬜"} ${p}`, `cp:toggleplat:${p}`),
  ]);
  rows.push(backRow());
  return Markup.inlineKeyboard(rows);
}

async function topicsText(): Promise<string> {
  const cfg = await getRuntimeConfig();
  return `📁 <b>Research topics</b>\n${cfg.researchTopics.map((t, i) => `${i + 1}. ${escapeHtml(t)}`).join("\n")}`;
}
async function topicsMarkup() {
  const cfg = await getRuntimeConfig();
  const rows = cfg.researchTopics.map((t, i) => [
    Markup.button.callback(`❌ ${t.length > 28 ? t.slice(0, 27) + "…" : t}`, `cp:rmtopic:${i}`),
  ]);
  rows.push([Markup.button.callback("➕ Add topic", "cp:prompttopic")]);
  rows.push(backRow());
  return Markup.inlineKeyboard(rows);
}

async function statusText(): Promise<string> {
  const s = await getStatus();
  const flag = (ok?: boolean) => (ok ? "✅" : "❌");
  const q = s.queues.pipeline as { active?: number; waiting?: number; failed?: number };
  const d = s.content.drafts as Record<string, number>;
  return [
    `📊 <b>System status</b>`,
    ``,
    `DB ${flag(s.health.postgres.ok)} · Redis ${flag(s.health.redis.ok)} · Gemini ${flag(s.health.gemini.ok)}`,
    `Higgsfield key: ${flag(s.integrations.higgsfield.configured)}`,
    `Auto-research: <b>${s.config.cronActive ? `ON (${s.config.researchCron})` : "PAUSED"}</b>`,
    ``,
    `Pending approval: <b>${d.PENDING_APPROVAL ?? 0}</b>`,
    `Scheduled: <b>${d.SCHEDULED ?? 0}</b> · Published: <b>${d.PUBLISHED ?? 0}</b>`,
    `Pipeline queue: ${q.active ?? 0} active, ${q.waiting ?? 0} waiting, ${q.failed ?? 0} failed`,
    `News items seen: ${s.content.newsItems}`,
  ].join("\n");
}

function escapeHtml(s: unknown): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
