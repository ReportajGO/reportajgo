import type { Platform } from "../domain/types.js";
import type { Publisher, PublishInput, PublishResult } from "./publisher.js";

/**
 * Placeholder for platforms not wired up yet (WEBSITE — awaiting site details;
 * YOUTUBE — content-posting API review). Conforms to Publisher so adding the
 * real adapter later is a drop-in swap. Fails loudly rather than silently
 * dropping a post.
 */
export class NotConfiguredPublisher implements Publisher {
  constructor(readonly platform: Platform) {}

  async publish(_input: PublishInput): Promise<PublishResult> {
    throw new Error(
      `${this.platform} publishing is not configured yet (API access pending). ` +
        `Implement a Publisher and register it in publish/registry.ts.`,
    );
  }
}
