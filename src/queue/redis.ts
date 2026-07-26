import { Redis } from "ioredis";
import { env } from "../config/env.js";

// A dedicated ioredis client for app-level primitives (e.g. the media-sweep
// lock). Kept separate from the plain options object that connection.ts hands
// BullMQ — BullMQ spins up its own internal clients and passing an instance
// triggers a dual-package clash.
export const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
