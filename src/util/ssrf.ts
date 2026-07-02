// SSRF protection for outbound fetches of URLs that originate in researched or
// operator-supplied content (article pages, og:image, source images).
//
// Without this, a crafted/redirecting URL can make the server request cloud
// metadata (169.254.169.254), localhost admin ports, or internal services.
import dns from "node:dns/promises";
import net from "node:net";

/** True for loopback / private / link-local / ULA / CGNAT ranges. */
export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split(".").map(Number);
    const a = parts[0]!;
    const b = parts[1]!;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true; // link-local incl. cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    return false;
  }
  const low = ip.toLowerCase();
  if (low === "::1" || low === "::") return true;
  if (low.startsWith("fc") || low.startsWith("fd")) return true; // ULA fc00::/7
  if (low.startsWith("fe80")) return true; // link-local
  const mapped = low.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIp(mapped[1]!);
  return false;
}

/**
 * Validate a URL is safe to fetch: http(s) only, and every resolved address is
 * public. Throws on anything internal/invalid. Returns the parsed URL.
 */
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
  // A literal internal IP as the host is caught here too (dns.lookup returns it).
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

/**
 * fetch() that refuses private/loopback/link-local targets and re-validates the
 * target after every redirect hop (so a public URL can't 302 into the internal
 * network). Use this for any URL that came from research/user input.
 */
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
