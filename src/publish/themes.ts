// Pushes the operator's topic filters to the website as themes (sections).
//
// Whenever the topic list changes (and once at boot), we POST the full desired
// list to the website's /api/agent/themes endpoint. The website upserts a theme
// per topic — creating its localized labels — and deactivates any theme no longer
// in the list, so adding/removing a filter makes the matching theme page + nav
// item appear/disappear on the site immediately.
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { themeSlug } from "../domain/themes.js";

const log = logger.child({ module: "publish:themes" });

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Sync the website's themes to the given topic filters. Never throws. */
export async function syncThemesToWebsite(topics: string[]): Promise<void> {
  if (!env.WEBSITE_API_KEY) {
    log.warn("WEBSITE_API_KEY not set; skipping theme sync");
    return;
  }
  // The topic names are written by the operator in the agent's primary content
  // language; the website translates them into every site locale.
  const lang = (env.contentLanguages[0] ?? "en").toLowerCase();
  const themes = topics
    .map((t) => t.trim())
    .filter(Boolean)
    .map((name) => ({ slug: themeSlug(name), name, lang }));

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
