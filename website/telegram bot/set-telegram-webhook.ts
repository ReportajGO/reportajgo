// Original location: scripts/set-telegram-webhook.ts
/**
 * Register (or remove) the Telegram webhook for the moderation bot.
 *
 * Usage:
 *   npx tsx scripts/set-telegram-webhook.ts          # set webhook
 *   npx tsx scripts/set-telegram-webhook.ts --info    # show current webhook
 *   npx tsx scripts/set-telegram-webhook.ts --delete  # remove webhook
 *
 * Reads from .env:
 *   TELEGRAM_BOT_TOKEN          — BotFather token
 *   TELEGRAM_WEBHOOK_BASE_URL   — public origin Telegram should call
 *   TELEGRAM_WEBHOOK_SECRET     — secret echoed back in the header on each update
 *
 * The webhook path is fixed at /api/telegram (see app/api/telegram/route.ts).
 */
import { Bot } from "grammy";

// Load .env into process.env (Next.js does this automatically, standalone
// scripts don't). process.loadEnvFile is built into Node ≥20.12 — no dotenv dep.
try {
  process.loadEnvFile();
} catch {
  // No .env file — rely on the ambient environment.
}

const WEBHOOK_PATH = "/api/telegram";

function env(name: string, required = true): string {
  const v = process.env[name]?.trim() ?? "";
  if (required && !v) {
    console.error(`✖ Missing required env var: ${name}`);
    process.exit(1);
  }
  return v;
}

async function main() {
  const mode = process.argv[2];
  const token = env("TELEGRAM_BOT_TOKEN");
  const bot = new Bot(token);

  if (mode === "--info") {
    const info = await bot.api.getWebhookInfo();
    console.log("Current webhook info:\n", JSON.stringify(info, null, 2));
    return;
  }

  if (mode === "--delete") {
    await bot.api.deleteWebhook({ drop_pending_updates: true });
    console.log("✓ Webhook deleted.");
    return;
  }

  const base = env("TELEGRAM_WEBHOOK_BASE_URL").replace(/\/$/, "");
  const secret = env("TELEGRAM_WEBHOOK_SECRET");
  const url = `${base}${WEBHOOK_PATH}`;

  if (base.startsWith("http://localhost") || base.startsWith("http://127.")) {
    console.warn(
      "⚠ Telegram cannot reach localhost. Use a public HTTPS URL " +
        "(e.g. an ngrok / cloudflared tunnel or your deployed domain).",
    );
  }

  await bot.api.setWebhook(url, {
    // Telegram returns this in the X-Telegram-Bot-Api-Secret-Token header,
    // letting the endpoint reject forged requests.
    secret_token: secret,
    // We only care about button presses for moderation.
    allowed_updates: ["callback_query"],
    drop_pending_updates: true,
  });

  console.log(`✓ Webhook set to: ${url}`);
  const info = await bot.api.getWebhookInfo();
  console.log("Verified:\n", JSON.stringify(info, null, 2));
}

main().catch((err) => {
  console.error("✖ Failed to configure webhook:", err);
  process.exit(1);
});
