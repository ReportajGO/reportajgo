// Production app entry point without the Telegram approval bot.
//
// This lets the approval dashboard/scheduler registration run as one deployable
// service while workers and the Telegram bot run in their own containers.
import { logger } from "./config/logger.js";
import { initSettings } from "./config/settingsStore.js";
import { prisma } from "./db/client.js";
import { startDashboard } from "./dashboard/server.js";
import { registerRepeatableJobs } from "./queue/schedule.js";
import { syncThemesToWebsite } from "./publish/themes.js";

async function bootstrap() {
  logger.info("ReportajGO backend app starting");
  const config = await initSettings();
  const server = startDashboard();
  await registerRepeatableJobs();
  void syncThemesToWebsite(config.researchTopics);
  logger.info("backend app ready");

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "backend app shutting down");
    server.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

bootstrap().catch((err) => {
  logger.error({ err }, "fatal error during backend app startup");
  process.exit(1);
});
