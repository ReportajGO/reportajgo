// Repair article covers that readers cannot load.
//
// The agent stores its generated images itself and hands the site a URL. When
// PUBLIC_BASE_URL was unset, that URL was http://localhost:3010/media/<file> —
// an address that resolves to nothing outside the agent's own container. Ingest
// kept it anyway, so those articles render a broken cover for every reader.
//
// This script walks the agent's posts, and for each unusable cover:
//   1. rebuilds the URL against the agent's PUBLIC origin (same /media/<file>),
//   2. re-hosts the image into public/uploads (or keeps the public URL when the
//      site uploads to S3),
//   3. clears the cover when the image is genuinely gone — <Cover> then draws
//      the branded gradient tile, which beats a broken image box.
//
// Run it inside the frontend container after deploying the compose change:
//   docker compose exec frontend node scripts/rehost-images.mjs
// Override the agent origin if it isn't https://<your-domain>/agent:
//   AGENT_MEDIA_BASE=https://reportagego.com/agent node scripts/rehost-images.mjs
// Add DRY_RUN=1 to see what it would do without writing anything.
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";

const prisma = new PrismaClient();
const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");
const DRY_RUN = process.env.DRY_RUN === "1";
const USES_S3 = (process.env.UPLOAD_STORAGE_DRIVER || "local") === "s3";
const EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif" };

// Where the agent's own /media is published. Caddy maps /agent/* to the backend.
const AGENT_MEDIA_BASE = (
  process.env.AGENT_MEDIA_BASE ||
  `${(process.env.SITE_URL || process.env.NEXTAUTH_URL || "https://reportajgo.uz").replace(/\/+$/, "")}/agent`
).replace(/\/+$/, "");

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }
  const low = ip.toLowerCase();
  return low === "::1" || low === "::" || low.startsWith("fc") || low.startsWith("fd") || low.startsWith("fe80");
}

/** Can a reader's browser load this cover? (CSP allows 'self', data:, https:) */
function loadableByReaders(url) {
  if (url.startsWith("/")) return true; // same-origin /uploads/...
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (host === "localhost" || host.endsWith(".localhost")) return false;
    if (net.isIP(host)) return !isPrivateIp(host);
    return host.includes(".");
  } catch {
    return false;
  }
}

/** The same file, addressed at the agent's public origin. */
function publicAgentUrl(url) {
  const idx = url.indexOf("/media/");
  return idx === -1 ? null : `${AGENT_MEDIA_BASE}${url.slice(idx)}`;
}

function sniff(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return "image/gif";
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (buf.toString("ascii", 4, 8) === "ftyp") { const b = buf.toString("ascii", 8, 12); if (b === "avif" || b === "avis") return "image/avif"; }
  return null;
}

/** Download and store under /uploads; returns the site-relative URL. */
async function rehost(url) {
  const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(25000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const type = sniff(buf);
  if (!type) throw new Error("not an image");
  if (DRY_RUN) return "/uploads/<dry-run>";
  await mkdir(UPLOAD_DIR, { recursive: true });
  const name = `${randomUUID()}.${EXT[type]}`;
  await writeFile(path.join(UPLOAD_DIR, name), buf);
  return `/uploads/${name}`;
}

/** Verify a URL really serves an image, without storing it. */
async function reachable(url) {
  try {
    const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(25000) });
    if (!res.ok) return false;
    return Boolean(sniff(Buffer.from(await res.arrayBuffer())));
  } catch {
    return false;
  }
}

const posts = await prisma.post.findMany({
  where: { origin: "agent", imageUrl: { not: null } },
  select: { id: true, imageUrl: true, title: true },
});
const broken = posts.filter((p) => !loadableByReaders(p.imageUrl));
console.log(
  `${posts.length} agent posts with a cover · ${broken.length} unloadable` +
    `${DRY_RUN ? " · DRY RUN" : ""}\nagent media origin: ${AGENT_MEDIA_BASE}`,
);

let fixed = 0;
let cleared = 0;
for (const p of broken) {
  const label = p.title.slice(0, 50);
  // The stored URL is unreachable by definition; try the same file at the
  // agent's public origin instead.
  const candidate = publicAgentUrl(p.imageUrl) ?? p.imageUrl;
  try {
    const cover = USES_S3
      ? ((await reachable(candidate)) ? candidate : null)
      : await rehost(candidate);
    if (!cover) throw new Error("image no longer served");
    if (!DRY_RUN) await prisma.post.update({ where: { id: p.id }, data: { imageUrl: cover } });
    console.log(`✓ ${label} -> ${cover}`);
    fixed++;
  } catch (e) {
    // Gone for good (the file predates the shared media volume, most likely).
    // Clear it so the article shows the branded placeholder, not a broken box.
    if (!DRY_RUN) await prisma.post.update({ where: { id: p.id }, data: { imageUrl: null } });
    console.error(`· ${label}: ${e.message} — cover cleared`);
    cleared++;
  }
}
console.log(`done: ${fixed} repaired, ${cleared} cleared`);
await prisma.$disconnect();
