import type { MetadataRoute } from "next";
import { locales } from "@/i18n/routing";
import { absoluteUrl } from "@/lib/seo";
import { getSitemapPosts } from "@/lib/posts";
import { getActiveThemes } from "@/lib/themes";

// Hits the DB, so it must render at request time — the production image builds
// with a placeholder DATABASE_URL and no live database.
export const dynamic = "force-dynamic";

// hreflang alternates for a locale-less path: absolute URL per locale + x-default.
function altLanguages(pathNoLocale: string): Record<string, string> {
  const languages: Record<string, string> = {};
  for (const l of locales) languages[l] = absoluteUrl(`/${l}${pathNoLocale}`);
  languages["x-default"] = absoluteUrl(`/${locales[0]}${pathNoLocale}`);
  return languages;
}

/**
 * XML sitemap (/sitemap.xml). Emits the homepage, every active section, and
 * every published article — once per locale — each cross-linked to its language
 * variants via hreflang. Section slugs are locale-independent, so we fetch them
 * once. A single sitemap is well within the 50k-URL limit for this site; if the
 * post count ever nears ~45k, split into a sitemap index.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [themes, posts] = await Promise.all([
    getActiveThemes(locales[0]),
    getSitemapPosts(),
  ]);
  const themeSlugs = themes.map((t) => t.slug);

  const entries: MetadataRoute.Sitemap = [];
  for (const locale of locales) {
    entries.push({
      url: absoluteUrl(`/${locale}`),
      changeFrequency: "hourly",
      priority: 1,
      alternates: { languages: altLanguages("") },
    });
    for (const slug of themeSlugs) {
      entries.push({
        url: absoluteUrl(`/${locale}/${slug}`),
        changeFrequency: "hourly",
        priority: 0.8,
        alternates: { languages: altLanguages(`/${slug}`) },
      });
    }
    for (const post of posts) {
      entries.push({
        url: absoluteUrl(`/${locale}/article/${post.slug}`),
        lastModified: post.updatedAt,
        changeFrequency: "daily",
        priority: 0.7,
        alternates: { languages: altLanguages(`/article/${post.slug}`) },
      });
    }
  }
  return entries;
}
