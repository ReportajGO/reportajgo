import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

/**
 * In-memory stand-in for the bits of ioredis the lock uses: `SET key v PX ttl NX`
 * plus the two Lua scripts. Expiry is driven by the (faked) clock, so a lock that
 * isn't renewed really does disappear mid-test.
 */
const fake = vi.hoisted(() => {
  const store = new Map<string, { value: string; expiresAt: number }>();

  const live = (key: string) => {
    const entry = store.get(key);
    if (!entry) return null;
    if (Date.now() >= entry.expiresAt) {
      store.delete(key);
      return null;
    }
    return entry;
  };

  return {
    store,
    redis: {
      set: async (key: string, value: string, _px: string, ttlMs: number, _nx: string) => {
        if (live(key)) return null;
        store.set(key, { value, expiresAt: Date.now() + ttlMs });
        return "OK";
      },
      eval: async (script: string, _keyCount: number, key: string, token: string, ttlMs?: string) => {
        const entry = live(key);
        if (!entry || entry.value !== token) return 0;
        if (script.includes("pexpire")) {
          entry.expiresAt = Date.now() + Number(ttlMs);
          return 1;
        }
        store.delete(key);
        return 1;
      },
    },
  };
});

vi.mock("../redis.js", () => ({ redis: fake.redis }));

// The real logger pulls in the env schema (DATABASE_URL etc.), which this unit
// test has no business requiring.
vi.mock("../../config/logger.js", () => ({
  logger: { child: () => ({ warn: () => {}, info: () => {}, debug: () => {} }) },
}));

const { tryWithLock } = await import("../lock.js");

describe("tryWithLock", () => {
  beforeEach(() => {
    fake.store.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("holds the lock for work that outlives the TTL", async () => {
    // The media-sweep bug: generation ran far longer than the lock's TTL, the key
    // expired underneath it, and the next tick started a second concurrent sweep
    // over the same drafts — every image generated twice.
    let releaseWork = () => {};
    const work = new Promise<string>((resolve) => {
      releaseWork = () => resolve("done");
    });

    const held = tryWithLock("k", 300, () => work);
    await vi.advanceTimersByTimeAsync(50);

    // Long past the TTL, but the holder is still working.
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await tryWithLock("k", 300, async () => "intruder")).toEqual({ ran: false });

    releaseWork();
    expect(await held).toEqual({ ran: true, result: "done" });
  });

  test("releases the lock when the work finishes", async () => {
    await tryWithLock("k", 300, async () => "first");
    expect(await tryWithLock("k", 300, async () => "second")).toEqual({
      ran: true,
      result: "second",
    });
  });

  test("releases the lock when the work throws", async () => {
    await expect(
      tryWithLock("k", 300, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(await tryWithLock("k", 300, async () => "after")).toEqual({
      ran: true,
      result: "after",
    });
  });

  test("a second caller is turned away while the first holds the lock", async () => {
    let releaseWork = () => {};
    const held = tryWithLock("k", 300, () => new Promise<string>((r) => (releaseWork = () => r("a"))));
    await vi.advanceTimersByTimeAsync(10);

    expect(await tryWithLock("k", 300, async () => "b")).toEqual({ ran: false });

    releaseWork();
    await held;
  });

  test("different keys don't block each other", async () => {
    let releaseWork = () => {};
    const held = tryWithLock("a", 300, () => new Promise<string>((r) => (releaseWork = () => r("a"))));
    await vi.advanceTimersByTimeAsync(10);

    expect(await tryWithLock("b", 300, async () => "b")).toEqual({ ran: true, result: "b" });

    releaseWork();
    await held;
  });

  test("a crashed holder's lock expires so work can resume", async () => {
    // No heartbeat runs once the process is gone: simulate by taking the key
    // directly, the way a dead holder would have left it.
    await fake.redis.set("k", "dead-holder", "PX", 300, "NX");
    expect(await tryWithLock("k", 300, async () => "blocked")).toEqual({ ran: false });

    await vi.advanceTimersByTimeAsync(400);
    expect(await tryWithLock("k", 300, async () => "resumed")).toEqual({
      ran: true,
      result: "resumed",
    });
  });
});
