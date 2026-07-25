import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { slugify, buildUniqueSlug } from "./slug";

// Bridges the pure slug helpers (lib/slug.ts) to the database: derives a unique
// Post.slug from a title and guards the create against the rare race where two
// concurrent requests pick the same free slug.

/** Whether any post already owns this slug (optionally excluding one post id). */
async function slugTaken(slug: string, excludePostId?: string): Promise<boolean> {
  const existing = await prisma.post.findUnique({
    where: { slug },
    select: { id: true },
  });
  return existing != null && existing.id !== excludePostId;
}

/**
 * Derive a unique slug for a headline. Pass the current post id when re-slugging
 * an existing post so it doesn't collide with itself.
 */
export function assignUniqueSlug(
  title: string,
  excludePostId?: string,
): Promise<string> {
  return buildUniqueSlug(slugify(title), (candidate) =>
    slugTaken(candidate, excludePostId),
  );
}

/** True when the error is a unique-constraint violation on Post.slug. */
function isSlugConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code !== "P2002") return false;
  const target = error.meta?.target;
  const fields = Array.isArray(target) ? target : [target];
  return fields.some((f) => typeof f === "string" && f.includes("slug"));
}

/**
 * Create a post whose slug is derived from `title` and guaranteed unique. The
 * `create` callback receives the chosen slug and performs the actual insert;
 * if a concurrent writer claims the slug first (unique-constraint race), we
 * regenerate and retry a few times before giving up.
 */
export async function createPostWithUniqueSlug<T>(
  title: string,
  create: (slug: string) => Promise<T>,
): Promise<T> {
  const MAX_ATTEMPTS = 5;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const slug = await assignUniqueSlug(title);
    try {
      return await create(slug);
    } catch (error) {
      if (attempt < MAX_ATTEMPTS && isSlugConflict(error)) continue;
      throw error;
    }
  }
  // Unreachable: the loop either returns or throws on the last attempt.
  throw new Error("createPostWithUniqueSlug exhausted retries");
}
