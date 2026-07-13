// Regenerate agent post images to the new "pure" style by pulling each story's
// REAL photo from its source article (og:image / twitter:image), re-hosted
// locally — no logo/headline overlay. Posts whose source has no usable image
// are listed at the end (they need a generated fallback via the agent).
//   DATABASE_URL="postgresql://reportajgo:reportajgo@localhost:5434/reportajgo_frontend?schema=public" node scripts/regen-from-source.mjs
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const prisma = new PrismaClient();
const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");
const EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif" };
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

function sniff(b) {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  if (b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (b.toString("ascii", 4, 8) === "ftyp") { const k = b.toString("ascii", 8, 12); if (k === "avif" || k === "avis") return "image/avif"; }
  return null;
}

const OG = [
  /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i,
  /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["']/i,
  /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["']/i,
];
function isPhoto(u) {
  const s = u.toLowerCase();
  if (/\.(svg|gif|ico)(\?|$)/.test(s)) return false;
  if (/(sprite|icon|logo|placeholder|default|avatar|favicon|blank)/.test(s)) return false;
  return true;
}
async function findOgImage(pageUrl) {
  const res = await fetch(pageUrl, { redirect: "follow", headers: { "user-agent": UA, accept: "text/html" }, signal: AbortSignal.timeout(15000) });
  if (!res.ok || !(res.headers.get("content-type") || "").includes("html")) return null;
  const html = await res.text();
  for (const re of OG) {
    const m = html.match(re);
    if (m?.[1]) {
      try { const abs = new URL(m[1].trim(), res.url || pageUrl).toString(); if (isPhoto(abs)) return abs; } catch {}
    }
  }
  return null;
}
async function rehost(url) {
  const res = await fetch(url, { redirect: "follow", headers: { "user-agent": UA, accept: "image/*" }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 8000) throw new Error("too small");
  const type = sniff(buf);
  if (!type) throw new Error("not an image");
  await mkdir(UPLOAD_DIR, { recursive: true });
  const name = `${randomUUID()}.${EXT[type]}`;
  await writeFile(path.join(UPLOAD_DIR, name), buf);
  return `/uploads/${name}`;
}

const posts = await prisma.post.findMany({
  where: { origin: "agent" },
  select: { id: true, sourceUrl: true, title: true },
});
console.log(`regenerating ${posts.length} agent posts from source photos...`);

let ok = 0;
const noSource = [];
for (const p of posts) {
  try {
    if (!p.sourceUrl) { noSource.push(p.title); continue; }
    const og = await findOgImage(p.sourceUrl);
    if (!og) { noSource.push(p.title); continue; }
    const local = await rehost(og);
    await prisma.post.update({ where: { id: p.id }, data: { imageUrl: local } });
    console.log(`✓ ${p.title.slice(0, 50)} -> ${local}`);
    ok++;
  } catch (e) {
    console.error(`✗ ${p.title.slice(0, 50)}: ${e.message}`);
    noSource.push(p.title);
  }
}
console.log(`\ndone: ${ok} got real source photos, ${noSource.length} need a generated fallback:`);
noSource.forEach((t) => console.log(`   - ${t.slice(0, 60)}`));
await prisma.$disconnect();
