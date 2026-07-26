// Central SEO/URL helpers: absolute-URL building and per-page canonical +
// hreflang alternates. Kept dependency-light (only i18n routing) so it can be
// imported from server components, metadata routes (sitemap/robots), and the
// root layout alike.
import type { Metadata } from "next";
import { locales, routing } from "@/i18n/routing";

// Public site origin. Overridable per environment; defaults to production.
// Single source of truth — the root layout imports SITE_URL from here.
export const SITE_URL = process.env.SITE_URL ?? "https://reportajgo.uz";

/** Make a root-relative path absolute against the public site origin. */
export function absoluteUrl(path: string): string {
  return new URL(path, SITE_URL).toString();
}

/**
 * Locale-prefix a path. `pathNoLocale` must be locale-less and start with "/"
 * ("" for the homepage). With `localePrefix: "always"`, every locale — including
 * the default — is prefixed (`/ru`, `/uz/tech`, …).
 */
export function localizedPath(locale: string, pathNoLocale: string): string {
  return `/${locale}${pathNoLocale}`;
}

/**
 * Build Next.js `alternates` for a page: a self-referencing canonical plus the
 * full hreflang set (every locale + an `x-default` pointing at the default
 * locale). Values are locale-prefixed paths; Next resolves them against
 * `metadataBase`. Use the SAME `pathNoLocale` for every language variant of a
 * page (posts/categories share one slug across locales).
 */
export function buildAlternates(
  locale: string,
  pathNoLocale: string,
): Metadata["alternates"] {
  const languages: Record<string, string> = {};
  for (const l of locales) languages[l] = localizedPath(l, pathNoLocale);
  languages["x-default"] = localizedPath(routing.defaultLocale, pathNoLocale);
  return {
    canonical: localizedPath(locale, pathNoLocale),
    languages,
  };
}
