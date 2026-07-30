import type { Context, Telegraf } from "telegraf";
import { Markup } from "telegraf";
import { logger } from "../config/logger.js";
import {
  getRuntimeConfig,
  updateRuntimeConfig,
  VALID_PLATFORMS,
} from "../config/settingsStore.js";
import { MARKETS } from "../domain/markets.js";
import { describe as describeQuota } from "../domain/quota.js";
import type { MarketCode, NewsPriority } from "../domain/types.js";
import { mixReport } from "../domain/verticals.js";
import { getEditorialStateSafe } from "../strategy/editorialState.js";
import { getStatus, publishAllPending, runPipelineNow } from "../dashboard/controlService.js";
import { rateLimited } from "./auth.js";

// Cooldowns for the two most expensive control-panel actions (Gemini/image/publish spend).
const RUN_COOLDOWN_MS = 60_000;
const PUBLISH_ALL_COOLDOWN_MS = 30_000;
import {
  isResearchCronActive,
  pauseResearchCron,
  reRegisterResearchCron,
  resumeResearchCron,
} from "../queue/schedule.js";

const log = logger.child({ module: "control-panel" });

const GEMINI_MODELS = ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash"];
const CRON_PRESETS: { label: string; pattern: string }[] = [
  { label: "Every 1h", pattern: "0 * * * *" },
  { label: "Every 2h", pattern: "0 */2 * * *" },
  { label: "Every 4h", pattern: "0 */4 * * *" },
  { label: "Every 6h", pattern: "0 */6 * * *" },
  { label: "Twice daily", pattern: "0 9,18 * * *" },
  { label: "Daily 09:00", pattern: "0 9 * * *" },
];
// Strong-filter tuning presets.
const SCORE_PRESETS = [0.45, 0.6, 0.7, 0.8];
const RELEVANCE_PRESETS = [0.3, 0.5, 0.7];
// BREAKING is deliberately absent: the ranker no longer assigns it (the network
// does not publish breaking news), so offering it would set a floor nothing can
// clear and silently empty the queue.
const PRIORITY_CHOICES: NewsPriority[] = ["LOW", "NORMAL", "HIGH"];

// chatId -> which value we're waiting for them to type next.
const pending = new Map<number, "cron">();

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
  // Quota + mix are the strategy's headline KPIs (TZ §15), so they lead the panel.
  const state = await getEditorialStateSafe();
  const q = state.quota;
  const quotaIcon =
    q.verdict === "ON_TARGET" ? "✅" : q.verdict === "UNDETERMINED" ? "➖" : "⚠️";

  const text =
    `🌍 <b>ReportageGO — Global Media Network</b>\n\n` +
    `Auto-research: <b>${active ? `ON · ${cfg.researchCron}` : "PAUSED"}</b>\n` +
    `Auto-publish: <b>${cfg.autoPublish ? "ON — tier A only, B/C held for review" : "OFF — approve first"}</b>\n` +
    `Markets: <b>${cfg.activeMarkets.length}</b> (${cfg.activeMarkets.slice(0, 6).join(", ")}${cfg.activeMarkets.length > 6 ? "…" : ""})\n` +
    `${quotaIcon} UZ quota: <b>${q.share}%</b> of ${q.totalCount} (target 18–22%)\n` +
    `Limit: <b>${cfg.maxItemsPerRun}/run</b> · Verticals: <b>${cfg.verticalsPerRun}/run</b>\n` +
    `Gate: <b>constructive ≥ ${cfg.minConstructiveness} · verified ≥ ${cfg.minVerifiability}</b>\n` +
    `Model: <b>${cfg.geminiModel}</b>`;
  const markup = Markup.inlineKeyboard([
    [Markup.button.callback("⏰ Schedule", "cp:schedule"), Markup.button.callback(`🔢 Limit (${cfg.maxItemsPerRun})`, "cp:limit")],
    [Markup.button.callback(`🔍 Freshness (${cfg.researchMaxAgeHours}h)`, "cp:freshness"), Markup.button.callback("🧠 AI model", "cp:model")],
    [Markup.button.callback(`🎯 Filter (≥${cfg.minScore} · ${cfg.minPriority})`, "cp:filter")],
    [Markup.button.callback("🌍 Markets", "cp:markets"), Markup.button.callback("📊 Editorial mix", "cp:mix")],
    [Markup.button.callback("📱 Platforms", "cp:platforms"), Markup.button.callback("📊 Status", "cp:status")],
    [Markup.button.callback(active ? "⏸️ Pause auto-research" : "▶️ Resume auto-research", "cp:togglecron")],
    [Markup.button.callback(cfg.autoPublish ? "🤖 Auto-publish: ON" : "🤖 Auto-publish: OFF", "cp:toggleauto")],
    [Markup.button.callback("🔥 Run pipeline now", "cp:run")],
    [Markup.button.callback("🚀 Publish all pending", "cp:publishall")],
  ]);
  return { text, markup };
}

/** Markets screen: toggle which of the 21 markets this deployment publishes to. */
async function marketsScreen(): Promise<{ text: string; markup: ReturnType<typeof Markup.inlineKeyboard> }> {
  const cfg = await getRuntimeConfig();
  const active = new Set(cfg.activeMarkets);
  const text =
    `🌍 <b>Markets</b> — ${active.size} of ${MARKETS.length} active\n\n` +
    `Each market publishes in its own language on its own platforms.\n` +
    `Tap to toggle.`;

  // Four per row keeps the 21 codes readable on a phone.
  const rows: ReturnType<typeof Markup.button.callback>[][] = [];
  for (let i = 0; i < MARKETS.length; i += 4) {
    rows.push(
      MARKETS.slice(i, i + 4).map((m) =>
        Markup.button.callback(
          `${active.has(m.code) ? "✅" : "⬜"} ${m.code}`,
          `cp:togglemarket:${m.code}`,
        ),
      ),
    );
  }
  rows.push(backRow());
  return { text, markup: Markup.inlineKeyboard(rows) };
}

/** Editorial mix screen: vertical drift against target shares (TZ §5.2, §15). */
async function mixScreen(): Promise<{ text: string; markup: ReturnType<typeof Markup.inlineKeyboard> }> {
  const state = await getEditorialStateSafe();
  const rows = mixReport(state.verticalCounts);
  const lines = rows.map((r) => {
    const icon = Math.abs(r.drift) <= 3 ? "✅" : r.drift > 0 ? "🔼" : "🔽";
    const sign = r.drift > 0 ? "+" : "";
    return `${icon} ${r.vertical}: <b>${r.actual}%</b> / ${r.target}% (${sign}${r.drift})`;
  });

  const text =
    `📊 <b>Editorial mix</b> — last 30 days\n\n` +
    `${lines.join("\n")}\n\n` +
    `${describeQuota(state.quota)}\n\n` +
    `Research automatically favours whichever vertical is furthest below target.`;
  return { text, markup: Markup.inlineKeyboard([backRow()]) };
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

  // Strong filter (score / relevance / priority gates)
  bot.action("cp:filter", async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    await safeEdit(ctx, await filterText(), await filterMarkup());
  });
  bot.action(/^cp:setminscore:([0-9.]+)$/, async (ctx) => {
    await applySettings({ minScore: Number(ctx.match[1]) });
    await ctx.answerCbQuery("Min score updated ✓").catch(() => {});
    await safeEdit(ctx, await filterText(), await filterMarkup());
  });
  bot.action(/^cp:setminrel:([0-9.]+)$/, async (ctx) => {
    await applySettings({ minRelevance: Number(ctx.match[1]) });
    await ctx.answerCbQuery("Min relevance updated ✓").catch(() => {});
    await safeEdit(ctx, await filterText(), await filterMarkup());
  });
  bot.action(/^cp:setminprio:(LOW|NORMAL|HIGH|BREAKING)$/, async (ctx) => {
    await applySettings({ minPriority: ctx.match[1] });
    await ctx.answerCbQuery("Min priority updated ✓").catch(() => {});
    await safeEdit(ctx, await filterText(), await filterMarkup());
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

  // NOTE: the language and topic screens were removed with the Global Media
  // Network strategy. Publication language is no longer an operator toggle — it
  // is a property of each market (Japan publishes Japanese, Saudi publishes
  // Arabic), so it is set by the Markets screen. Topics are the seven fixed
  // verticals, which are editorial policy rather than configuration.

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

  // Markets (toggle which of the 21 markets are active)
  bot.action("cp:markets", async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const { text, markup } = await marketsScreen();
    await safeEdit(ctx, text, markup);
  });
  bot.action(/^cp:togglemarket:([A-Z]{2})$/, async (ctx) => {
    const cfg = await getRuntimeConfig();
    const code = ctx.match[1] as MarketCode;
    const set = new Set(cfg.activeMarkets);
    if (set.has(code)) set.delete(code);
    else set.add(code);
    if (set.size === 0) {
      await ctx.answerCbQuery("Keep at least one market", { show_alert: true }).catch(() => {});
      return;
    }
    await applySettings({ activeMarkets: [...set] });
    await ctx.answerCbQuery("Updated ✓").catch(() => {});
    const { text, markup } = await marketsScreen();
    await safeEdit(ctx, text, markup);
  });

  // Editorial mix (vertical drift vs target shares + quota position)
  bot.action("cp:mix", async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const { text, markup } = await mixScreen();
    await safeEdit(ctx, text, markup);
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
    if (rateLimited(ctx.from?.id, "cp:run", RUN_COOLDOWN_MS)) {
      await ctx.answerCbQuery("⏳ Just ran — please wait a minute.", { show_alert: true }).catch(() => {});
      return;
    }
    try {
      const { jobId } = await runPipelineNow();
      await ctx.answerCbQuery("Pipeline started 🔥").catch(() => {});
      await ctx.reply(`🔥 Research run queued (job ${jobId}). New posts will arrive here for approval.`);
    } catch (err) {
      log.error({ err }, "cp:run failed");
      await ctx.answerCbQuery("Something went wrong. Try again.", { show_alert: true }).catch(() => {});
    }
  });

  // Publish everything pending at once (skip per-item approval)
  bot.action("cp:publishall", async (ctx) => {
    if (rateLimited(ctx.from?.id, "cp:publishall", PUBLISH_ALL_COOLDOWN_MS)) {
      await ctx.answerCbQuery("⏳ Please wait a moment before publishing again.", { show_alert: true }).catch(() => {});
      return;
    }
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
      log.error({ err }, "cp:publishall failed");
      await ctx.answerCbQuery("Something went wrong. Try again.", { show_alert: true }).catch(() => {});
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
    }
    const { text: menuText, markup } = await mainMenu();
    await ctx.reply(menuText, { parse_mode: "HTML", ...markup });
  } catch (err) {
    await ctx.reply(`❌ ${err instanceof Error ? err.message : "failed to save"}`);
  }
  return true;
}

// ── submenu builders ─────────────────────────────────────────────────────────
async function platformsMarkup() {
  const cfg = await getRuntimeConfig();
  const rows = VALID_PLATFORMS.map((p) => [
    Markup.button.callback(`${cfg.enabledPlatforms.includes(p) ? "✅" : "⬜"} ${p}`, `cp:toggleplat:${p}`),
  ]);
  rows.push(backRow());
  return Markup.inlineKeyboard(rows);
}

async function filterText(): Promise<string> {
  const c = await getRuntimeConfig();
  const list = (a: string[]) => (a.length ? escapeHtml(a.join(", ")) : "—");
  return [
    `🎯 <b>Strong filter</b>`,
    `Only stories clearing these bars get drafted.`,
    ``,
    `Min score: <b>${c.minScore}</b>`,
    `Min relevance: <b>${c.minRelevance}</b>`,
    `Min priority: <b>${c.minPriority}</b>`,
    ``,
    `Source allow: <code>${list(c.sourceAllowlist)}</code>`,
    `Source block: <code>${list(c.sourceBlocklist)}</code>`,
    `Keyword allow: <code>${list(c.keywordAllowlist)}</code>`,
    `Keyword block: <code>${list(c.keywordBlocklist)}</code>`,
    ``,
    `<i>Lists are edited via the dashboard API (PUT /settings).</i>`,
  ].join("\n");
}
async function filterMarkup() {
  const c = await getRuntimeConfig();
  const scoreRow = SCORE_PRESETS.map((n) =>
    Markup.button.callback(`${n === c.minScore ? "✅ " : ""}≥${n}`, `cp:setminscore:${n}`),
  );
  const relRow = RELEVANCE_PRESETS.map((n) =>
    Markup.button.callback(`${n === c.minRelevance ? "✅ " : ""}rel ${n}`, `cp:setminrel:${n}`),
  );
  const prioRow = PRIORITY_CHOICES.map((p) =>
    Markup.button.callback(`${p === c.minPriority ? "✅ " : ""}${p}`, `cp:setminprio:${p}`),
  );
  return Markup.inlineKeyboard([scoreRow, relRow, prioRow, backRow()]);
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
