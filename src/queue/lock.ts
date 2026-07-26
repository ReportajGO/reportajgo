import { logger } from "../config/logger.js";
import { redis } from "./redis.js";

const log = logger.child({ module: "lock" });

const RELEASE_IF_OWNER =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

/**
 * Best-effort mutual exclusion via a Redis `SET key NX PX` lock. Runs `fn` only
 * if the lock is acquired; otherwise returns `{ ran: false }` immediately (no
 * blocking). The TTL caps how long a crashed holder can block others, and we
 * release only our own token (compare-and-delete) so a lock that already expired
 * and was re-taken elsewhere isn't deleted out from under its new owner.
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
  try {
    return { ran: true, result: await fn() };
  } finally {
    try {
      await redis.eval(RELEASE_IF_OWNER, 1, key, token);
    } catch (err) {
      log.warn({ err, key }, "failed to release lock (it will expire via TTL)");
    }
  }
}

let lockCounter = 0;
