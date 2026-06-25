// Generate per-platform copy + media for all SELECTED news items.
// Usage: npx tsx src/scripts/draft-selected.ts
import { prisma } from "../db/client.js";
import { draftSelectedItems } from "../generate/copy/copyService.js";
import { generateMediaForPendingDrafts } from "../generate/media/mediaService.js";

async function main() {
  const drafts = await draftSelectedItems();
  const media = await generateMediaForPendingDrafts();
  // eslint-disable-next-line no-console
  console.log("RESULT", JSON.stringify({ ...drafts, ...media }));
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error("draft-selected failed:", err?.message ?? err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
