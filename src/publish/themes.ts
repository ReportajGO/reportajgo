// Pushes the network's content verticals to the website as themes (sections).
//
// We POST the full desired list to the website's /api/agent/themes endpoint. The
// website upserts a theme per entry — creating its localized labels — and
// deactivates any theme no longer in the list, so the site's section pages and
// nav mirror the agent's editorial structure.
//
// Under the Global Media Network strategy the sections are the SEVEN FIXED
// VERTICALS (TZ §5.1), not an operator-edited free-text topic list. The sections
// are part of the published strategy, so they are derived from
// `domain/verticals.ts` rather than from mutable configuration — the site's
// information architecture should not drift when someone edits a filter.
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { themeSlug } from "../domain/themes.js";
import { VERTICALS } from "../domain/verticals.js";

const log = logger.child({ module: "publish:themes" });

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface ThemeEntry {
  slug: string;
  name: string;
}

/**
 * The website's sections: one per content vertical.
 *
 * The slug is derived from the stable vertical id (e.g. "economy"), not from the
 * display label, so renaming a label in a future editorial revision does not
 * orphan the section's URL and its published articles.
 */
export function verticalThemes(): ThemeEntry[] {
  return VERTICALS.map((v) => ({ slug: v.id.toLowerCase(), name: v.nameEn }));
}

/** Sync the website's themes to the seven content verticals. Never throws. */
export async function syncVerticalThemesToWebsite(): Promise<void> {
  return syncThemesToWebsite(verticalThemes());
}

/**
 * Sync the website's themes to an explicit list. Never throws.
 *
 * Accepts either `ThemeEntry` objects (preferred — explicit, stable slugs) or
 * bare names, which get a slug derived from the name.
 */
export async function syncThemesToWebsite(
  entries: (ThemeEntry | string)[],
): Promise<void> {
  if (!env.WEBSITE_API_KEY) {
    log.warn("WEBSITE_API_KEY not set; skipping theme sync");
    return;
  }
  // Labels are supplied in the agent's primary content language; the website
  // translates them into every site locale.
  const lang = (env.contentLanguages[0] ?? "en").toLowerCase();
  const themes = entries
    .map((entry) =>
      typeof entry === "string"
        ? { slug: themeSlug(entry.trim()), name: entry.trim() }
        : { slug: entry.slug.trim(), name: entry.name.trim() },
    )
    .filter((t) => t.slug && t.name)
    .map((t) => ({ ...t, lang }));

  if (themes.length === 0) return;

  const endpoint = `${env.WEBSITE_API_URL.replace(/\/+$/, "")}/api/agent/themes`;
  const attempts = 6;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${env.WEBSITE_API_KEY}`,
        },
        body: JSON.stringify({ themes }),
        signal: AbortSignal.timeout(60_000),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        log.warn({ status: res.status, data, attempt, attempts }, "theme sync failed");
      } else {
        log.info({ count: themes.length, ...data }, "themes synced to website");
        return;
      }
    } catch (err) {
      log.warn({ err, attempt, attempts }, "theme sync request error");
    }

    if (attempt < attempts) await sleep(attempt * 2_000);
  }
}
