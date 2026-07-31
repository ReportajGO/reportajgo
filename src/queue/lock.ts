import { logger } from "../config/logger.js";
import { redis } from "./redis.js";

const log = logger.child({ module: "lock" });

const RELEASE_IF_OWNER =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

const RENEW_IF_OWNER =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end";

/**
 * Best-effort mutual exclusion via a Redis `SET key NX PX` lock. Runs `fn` only
 * if the lock is acquired; otherwise returns `{ ran: false }` immediately (no
 * blocking). The TTL caps how long a crashed holder can block others, and we
 * release only our own token (compare-and-delete) so a lock that already expired
 * and was re-taken elsewhere isn't deleted out from under its new owner.
 *
 * The TTL is a CRASH timeout, not a work budget: while `fn` is still running we
 * heartbeat the key back up to the full TTL. Without that, any job that outlives
 * its TTL silently loses the lock mid-run and a second caller starts the same
 * work concurrently — which is exactly how the media sweep ended up generating
 * every image twice.
 */
export async function tryWithLock<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<{ ran: true; result: T } | { ran: false }> {
  // Vary the token by pid + counter so it's unique per holder without needing a
  // wall clock (workflows aside, this is plain app code — Date.now() is fine).
  const token = `${process.pid}:${Date.now()}:${lockCounter++}`;
  const acquired = await redis.set(key, token, "PX", ttlMs, "NX");
  if (acquired !== "OK") return { ran: false };

  // Renew at a third of the TTL, so a missed beat or a slow Redis round-trip
  // still leaves two more chances before the key would expire. The floor must
  // stay well under the TTL itself — a floor that outran a short TTL would leave
  // the lock unrenewable, which is the very failure this guards against.
  const renewEveryMs = Math.max(50, Math.floor(ttlMs / 3));
  const heartbeat = setInterval(() => {
    void redis.eval(RENEW_IF_OWNER, 1, key, token, String(ttlMs)).catch((err: unknown) => {
      log.warn({ err, key }, "failed to renew lock; it may expire while work is in flight");
    });
  }, renewEveryMs);
  heartbeat.unref();

  try {
    return { ran: true, result: await fn() };
  } finally {
    clearInterval(heartbeat);
    try {
      await redis.eval(RELEASE_IF_OWNER, 1, key, token);
    } catch (err) {
      log.warn({ err, key }, "failed to release lock (it will expire via TTL)");
    }
  }
}

let lockCounter = 0;
