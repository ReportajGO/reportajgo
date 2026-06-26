// One-time: wipe ALL news items (and their cascaded drafts, media, scheduled
// posts) from the agent DB for a fresh start. Settings/approvers are kept.
// Website-published articles live in the website DB and are untouched.
//   npx tsx src/scripts/purge-news.ts
import { prisma } from "../db/client.js";

const before = {
  news: await prisma.newsItem.count(),
  drafts: await prisma.postDraft.count(),
  media: await prisma.mediaAsset.count(),
  scheduled: await prisma.scheduledPost.count(),
};
console.log("before:", before);

const res = await prisma.newsItem.deleteMany({});
console.log(`deleted ${res.count} news items (drafts/media/scheduled cascaded)`);

console.log("after:", {
  news: await prisma.newsItem.count(),
  drafts: await prisma.postDraft.count(),
  media: await prisma.mediaAsset.count(),
  scheduled: await prisma.scheduledPost.count(),
});

await prisma.$disconnect();
