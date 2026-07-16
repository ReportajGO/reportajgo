// Workers-only entry point (no dashboard). Use for horizontal scaling:
// run one `npm run dev`/`start` for the dashboard + scheduling, and N of these
// for processing throughput.
import { logger } from "./config/logger.js";
import { prisma } from "./db/client.js";
import { higgsfieldPreflight } from "./integrations/higgsfield/preflight.js";
import { startWorkers } from "./queue/workers.js";

const workers = startWorkers();
logger.info("worker process ready");
// Self-check image generation up front so the logs show immediately whether the
// Higgsfield token + network are healthy (this worker is the one that makes media).
void higgsfieldPreflight();

const shutdown = async (signal: string) => {
  logger.info({ signal }, "worker shutting down");
  await Promise.all(workers.map((w) => w.close()));
  await prisma.$disconnect();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
