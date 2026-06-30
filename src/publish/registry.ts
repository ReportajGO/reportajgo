import { env } from "../config/env.js";
import type { Platform } from "../domain/types.js";
import { InstagramWebPublisher } from "./instagramWeb/index.js";
import { FacebookPublisher, InstagramPublisher } from "./meta.js";
import { NotConfiguredPublisher } from "./notConfigured.js";
import type { Publisher } from "./publisher.js";
import { TelegramPublisher } from "./telegram.js";
import { WebsitePublisher } from "./website.js";

// Lazy singletons — publishers validate their credentials in the constructor,
// so we only build one when a post for that platform is actually published.
const cache = new Map<Platform, Publisher>();

const factories: Record<Platform, () => Publisher> = {
  TELEGRAM: () => new TelegramPublisher(),
  // Web automation (instagram.com) or the Meta Graph API, per INSTAGRAM_PUBLISHER.
  INSTAGRAM: () =>
    env.INSTAGRAM_PUBLISHER === "web" ? new InstagramWebPublisher() : new InstagramPublisher(),
  FACEBOOK: () => new FacebookPublisher(),
  YOUTUBE: () => new NotConfiguredPublisher("YOUTUBE"),
  WEBSITE: () => new WebsitePublisher(),
};

export function getPublisher(platform: Platform): Publisher {
  const existing = cache.get(platform);
  if (existing) return existing;
  const publisher = factories[platform]();
  cache.set(platform, publisher);
  return publisher;
}
