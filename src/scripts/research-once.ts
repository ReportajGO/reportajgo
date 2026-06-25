// One-shot runner for the research+filter pipeline.
// Usage: npx tsx src/scripts/research-once.ts
import { logger } from "../config/logger.js";
import { prisma } from "../db/client.js";
import { runResearchPipeline } from "../pipeline/researchPipeline.js";

async function main() {
  const summary = await runResearchPipeline();
  logger.info(summary, "done");

  const top = await prisma.newsItem.findMany({
    where: { status: "SELECTED" },
    orderBy: { score: "desc" },
    take: 10,
    select: { title: true, score: true, sourceName: true, topic: true },
  });
  // eslint-disable-next-line no-console
  console.table(top);
}

main()
  .catch((err) => {
    logger.error({ err }, "research-once failed");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
