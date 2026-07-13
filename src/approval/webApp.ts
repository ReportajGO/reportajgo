// Telegram Mini App wiring.
//
// Exposes the local ReportajGO website (WEBSITE_API_URL) over a public HTTPS
// cloudflared "quick tunnel", then points the approval bot's menu button — the
// "app" you open from inside the bot — at the website admin page.
//
// Quick-tunnel hostnames are ephemeral (a new *.trycloudflare.com each launch),
// which is why a statically-configured button goes dead on restart. This module
// captures the live URL from cloudflared's output and (re-)sets the menu button
// every time the tunnel connects, including after a crash/restart.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Telegraf } from "telegraf";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";

const log = logger.child({ module: "telegram-webapp" });

const TRYCLOUDFLARE_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;
const RESTART_DELAY_MS = 5_000;

/** Locate the cloudflared binary: explicit env → ./bin → PATH. */
function resolveCloudflared(): string {
  if (env.CLOUDFLARED_PATH && existsSync(env.CLOUDFLARED_PATH)) return env.CLOUDFLARED_PATH;
  const local = join(
    process.cwd(),
    "bin",
    process.platform === "win32" ? "cloudflared.exe" : "cloudflared",
  );
  if (existsSync(local)) return local;
  return process.platform === "win32" ? "cloudflared.exe" : "cloudflared";
}

async function setMenuButton(bot: Telegraf, url: string): Promise<void> {
  await bot.telegram.setChatMenuButton({
    menuButton: { type: "web_app", text: env.WEBAPP_MENU_TEXT, web_app: { url } },
  });
  log.info({ url }, "telegram web app menu button set");
}

/**
 * Start the Mini App tunnel and keep the bot's menu button pointed at the live
 * admin URL. No-op (returns undefined) when WEBAPP_ENABLED=false.
 */
export function startWebApp(bot: Telegraf): { stop: () => void } | undefined {
  if (!env.WEBAPP_ENABLED) {
    log.info("WEBAPP_ENABLED=false; skipping Telegram Mini App tunnel");
    return undefined;
  }

  if (env.WEBAPP_PUBLIC_URL) {
    void setMenuButton(bot, env.WEBAPP_PUBLIC_URL).catch((err) =>
      log.error({ err }, "failed to set telegram menu button"),
    );
    log.info({ url: env.WEBAPP_PUBLIC_URL }, "using direct Telegram Mini App URL");
    return { stop: () => {} };
  }

  const bin = resolveCloudflared();
  const target = env.WEBSITE_API_URL.replace(/\/$/, "");
  const path = env.WEBAPP_PATH.startsWith("/") ? env.WEBAPP_PATH : `/${env.WEBAPP_PATH}`;

  let child: ChildProcess | undefined;
  let stopped = false;
  let lastUrl = "";
  let restartTimer: NodeJS.Timeout | undefined;

  const handleOutput = (buf: Buffer): void => {
    const match = buf.toString().match(TRYCLOUDFLARE_RE);
    if (!match || match[0] === lastUrl) return;
    lastUrl = match[0];
    const webAppUrl = `${match[0]}${path}`;
    void setMenuButton(bot, webAppUrl).catch((err) =>
      log.error({ err }, "failed to set telegram menu button"),
    );
  };

  const spawnTunnel = (): void => {
    if (stopped) return;
    log.info({ bin, target }, "starting cloudflared quick tunnel for Mini App");
    child = spawn(bin, ["tunnel", "--no-autoupdate", "--url", target], { windowsHide: true });

    child.stdout?.on("data", handleOutput);
    child.stderr?.on("data", handleOutput);

    child.on("error", (err) =>
      log.error({ err }, "cloudflared failed to start (is the binary present in ./bin?)"),
    );
    child.on("exit", (code) => {
      log.warn({ code }, "cloudflared exited; restarting tunnel");
      lastUrl = "";
      if (!stopped) restartTimer = setTimeout(spawnTunnel, RESTART_DELAY_MS);
    });
  };

  spawnTunnel();

  return {
    stop: () => {
      stopped = true;
      if (restartTimer) clearTimeout(restartTimer);
      child?.kill();
    },
  };
}
