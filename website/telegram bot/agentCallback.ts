// Original location: src/lib/agentCallback.ts
import type { Post } from "@prisma/client";

/**
 * Outbound notification to the AI agent when a post's moderation outcome is
 * decided. Lets the agent immediately cross-post approved items to "other
 * places" instead of polling. Entirely optional and best-effort:
 *  - disabled unless AGENT_CALLBACK_URL is set;
 *  - failures are logged, never thrown (must not break moderation).
 *
 * The agent can verify authenticity via the X-Callback-Secret header
 * (AGENT_CALLBACK_SECRET).
 */
export async function notifyAgentDecision(
  post: Pick<
    Post,
    | "id"
    | "title"
    | "excerpt"
    | "language"
    | "status"
    | "sourceUrl"
    | "imageUrl"
    | "approvedAt"
    | "publishAt"
  > & { category?: string },
): Promise<void> {
  const url = process.env.AGENT_CALLBACK_URL;
  if (!url) return;

  // Distinguish a future-dated approval (the agent should cross-post AT that
  // time, not now) from an immediate one.
  const scheduled =
    post.status === "PUBLISHED" &&
    post.publishAt !== null &&
    post.publishAt.getTime() > Date.now();
  const event =
    post.status !== "PUBLISHED"
      ? "post.rejected"
      : scheduled
        ? "post.scheduled"
        : "post.approved";

  try {
    await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.AGENT_CALLBACK_SECRET
          ? { "X-Callback-Secret": process.env.AGENT_CALLBACK_SECRET }
          : {}),
      },
      body: JSON.stringify({
        event,
        post: {
          id: post.id,
          title: post.title,
          excerpt: post.excerpt,
          language: post.language,
          category: post.category ?? null,
          status: post.status,
          sourceUrl: post.sourceUrl,
          imageUrl: post.imageUrl,
          approvedAt: post.approvedAt,
          publishAt: post.publishAt, // when it goes (or went) live; null = now
          // public canonical URL of the article on this site
          url: `/${post.language}/article/${post.id}`,
        },
      }),
    });
  } catch (err) {
    console.error("[agent] callback failed:", err);
  }
}
