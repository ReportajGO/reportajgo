// One-off: re-host agent post images that point at an external host
// (http://localhost:3010/media/...) into local /uploads so they pass the site
// CSP and display. Run from the website dir:
//   DATABASE_URL="postgresql://reportajgo:reportajgo@localhost:5434/reportajgo_frontend?schema=public" node scripts/rehost-images.mjs
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const prisma = new PrismaClient();
const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");
const EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif" };

function sniff(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return "image/gif";
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (buf.toString("ascii", 4, 8) === "ftyp") { const b = buf.toString("ascii", 8, 12); if (b === "avif" || b === "avis") return "image/avif"; }
  return null;
}

async function rehost(url) {
  const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(25000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const type = sniff(buf);
  if (!type) throw new Error("not an image");
  await mkdir(UPLOAD_DIR, { recursive: true });
  const name = `${randomUUID()}.${EXT[type]}`;
  await writeFile(path.join(UPLOAD_DIR, name), buf);
  return `/uploads/${name}`;
}

const posts = await prisma.post.findMany({
  where: { origin: "agent", imageUrl: { startsWith: "http" } },
  select: { id: true, imageUrl: true, title: true },
});
console.log(`found ${posts.length} agent posts with external images`);

let ok = 0, fail = 0;
for (const p of posts) {
  try {
    const local = await rehost(p.imageUrl);
    await prisma.post.update({ where: { id: p.id }, data: { imageUrl: local } });
    console.log(`✓ ${p.title.slice(0, 50)} -> ${local}`);
    ok++;
  } catch (e) {
    console.error(`✗ ${p.title.slice(0, 50)}: ${e.message}`);
    fail++;
  }
}
console.log(`done: ${ok} re-hosted, ${fail} failed`);
await prisma.$disconnect();
