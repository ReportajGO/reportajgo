import { env } from "../config/env.js";

// Pass plain connection OPTIONS to BullMQ (not a shared ioredis instance).
// BullMQ creates its own clients internally; passing an instance triggers a
// dual-package type clash because BullMQ bundles its own ioredis copy.
function parseRedisOptions() {
  const u = new URL(env.REDIS_URL);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    ...(u.password ? { password: u.password } : {}),
    ...(u.username ? { username: u.username } : {}),
    db: u.pathname && u.pathname.length > 1 ? Number(u.pathname.slice(1)) || 0 : 0,
    // Required by BullMQ for blocking commands.
    maxRetriesPerRequest: null,
  };
}

export const connection = parseRedisOptions();

export const QUEUE_NAMES = {
  // Full research -> filter -> copy -> media chain (repeatable on RESEARCH_CRON).
  pipeline: "pipeline",
  // One job per due ScheduledPost.
  publish: "publish",
  // Repeatable scan that finds due posts and enqueues publish jobs.
  scheduler: "scheduler",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];
