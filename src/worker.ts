// Workers-only entry point (no dashboard). Use for horizontal scaling:
// run one `npm run dev`/`start` for the dashboard + scheduling, and N of these
// for processing throughput.
import { logger } from "./config/logger.js";
import { prisma } from "./db/client.js";
import { startWorkers } from "./queue/workers.js";

const workers = startWorkers();
logger.info("worker process ready");

const shutdown = async (signal: string) => {
  logger.info({ signal }, "worker shutting down");
  await Promise.all(workers.map((w) => w.close()));
  await prisma.$disconnect();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
