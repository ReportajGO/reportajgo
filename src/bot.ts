// Telegram approval/control bot entry point.
//
// Kept coupled to backend internals for v1: it uses the same Prisma schema,
// queues, settings store, and dashboard services as the backend app.
import { startApprovalBot } from "./approval/telegramBot.js";
import { logger } from "./config/logger.js";
import { initSettings } from "./config/settingsStore.js";
import { prisma } from "./db/client.js";

async function bootstrap() {
  logger.info("ReportajGO Telegram bot starting");
  await initSettings();
  const bot = startApprovalBot();
  if (!bot) {
    logger.error("Telegram bot did not start; check TELEGRAM_APPROVAL_BOT_TOKEN and APPROVERS");
    await prisma.$disconnect();
    process.exit(1);
  }
  logger.info("Telegram bot ready");

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Telegram bot shutting down");
    bot.stop();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

bootstrap().catch((err) => {
  logger.error({ err }, "fatal error during Telegram bot startup");
  process.exit(1);
});
