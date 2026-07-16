// Application entry point — runs the whole system in one process:
//  - approval dashboard (HTTP)
//  - queue workers (pipeline / publish / scheduler)
//  - repeatable jobs (research cron + due-post scanner)
//
// For horizontal scaling, run `npm run worker` (workers only) on separate
// machines and keep this process for the dashboard.
import { startApprovalBot } from "./approval/telegramBot.js";
import { logger } from "./config/logger.js";
import { initSettings } from "./config/settingsStore.js";
import { prisma } from "./db/client.js";
import { startDashboard } from "./dashboard/server.js";
import { higgsfieldPreflight } from "./integrations/higgsfield/preflight.js";
import { registerRepeatableJobs } from "./queue/schedule.js";
import { startWorkers } from "./queue/workers.js";
import { syncThemesToWebsite } from "./publish/themes.js";

async function bootstrap() {
  logger.info("ReportajGO agent starting");
  const config = await initSettings(); // warm the runtime-config cache before anything reads it
  const server = startDashboard();
  const workers = startWorkers();
  const approvalBot = startApprovalBot();
  await registerRepeatableJobs();
  // Make sure the website's themes reflect the current topic filters at startup.
  void syncThemesToWebsite(config.researchTopics);
  // Self-check image generation so the logs show if the Higgsfield token/network is healthy.
  void higgsfieldPreflight();
  logger.info("agent ready");

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "shutting down");
    server.close();
    approvalBot?.stop();
    await Promise.all(workers.map((w) => w.close()));
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

bootstrap().catch((err) => {
  logger.error({ err }, "fatal error during startup");
  process.exit(1);
});
