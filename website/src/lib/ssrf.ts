// SSRF protection for server-side fetches of caller-supplied URLs (e.g. the AI
// agent's image URLs re-hosted via saveImageFromUrl). Blocks requests to
// loopback / private / link-local ranges and cloud metadata (169.254.169.254),
// and re-validates every redirect hop so a public URL can't 302 into the LAN.
import dns from "node:dns/promises";
import net from "node:net";

export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split(".").map(Number);
    const a = parts[0]!;
    const b = parts[1]!;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }
  const low = ip.toLowerCase();
  if (low === "::1" || low === "::") return true;
  if (low.startsWith("fc") || low.startsWith("fd")) return true;
  if (low.startsWith("fe80")) return true;
  const mapped = low.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIp(mapped[1]!);
  return false;
}

export async function assertPublicUrl(raw: string): Promise<URL> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("invalid URL");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error(`blocked URL scheme: ${u.protocol}`);
  }
  const results = await dns.lookup(u.hostname, { all: true }).catch(() => {
    throw new Error("DNS resolution failed");
  });
  if (results.length === 0) throw new Error("DNS resolution failed");
  for (const r of results) {
    if (isPrivateIp(r.address)) throw new Error("blocked internal address");
  }
  return u;
}

const MAX_REDIRECTS = 4;

/** SSRF-safe fetch: validates the target and each redirect hop is public. */
export async function safeFetch(
  rawUrl: string,
  init: RequestInit = {},
  timeoutMs = 25_000,
): Promise<Response> {
  let url = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicUrl(url);
    const res = await fetch(url, {
      ...init,
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
    const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!location) return res;
    url = new URL(location, url).toString();
  }
  throw new Error("too many redirects");
}
