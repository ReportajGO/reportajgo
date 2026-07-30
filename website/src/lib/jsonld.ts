// Builders for schema.org JSON-LD structured data. Each returns a plain object
// to hand to <JsonLd data={...} />. Absolute URLs throughout (search engines
// require them). Rendered on the article, category, and home pages to make the
// site eligible for Google rich results / Top Stories.
import type { PostDTO } from "./posts";
import { SITE_URL, absoluteUrl } from "./seo";
import { SOCIALS } from "@/components/SocialLinks";

const SITE_NAME = "ReportageGO";
const LOGO_URL = absoluteUrl("/icon.png");
const DEFAULT_OG = absoluteUrl("/og-default.png");
// Google truncates news headlines beyond ~110 characters.
const MAX_HEADLINE = 110;

/** Shared Organization node (publisher + brand identity). */
function organization() {
  return {
    "@type": "Organization",
    name: SITE_NAME,
    url: SITE_URL,
    logo: { "@type": "ImageObject", url: LOGO_URL },
    sameAs: SOCIALS.map((s) => s.href),
  };
}

/** Absolute image URL for a post (its cover, or the branded default). */
function postImage(imageUrl: string | null): string {
  if (!imageUrl) return DEFAULT_OG;
  return imageUrl.startsWith("http") ? imageUrl : absoluteUrl(imageUrl);
}

/** Standalone Organization node for the homepage. */
export function organizationLd() {
  return { "@context": "https://schema.org", ...organization() };
}

/** WebSite node with a sitelinks search box wired to /{locale}/search. */
export function websiteLd(locale: string) {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME,
    url: SITE_URL,
    inLanguage: locale,
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: absoluteUrl(`/${locale}/search?q={search_term_string}`),
      },
      "query-input": "required name=search_term_string",
    },
  };
}

/** NewsArticle node for an article page. `path` is the canonical locale path. */
export function newsArticleLd(post: PostDTO, locale: string, path: string) {
  const url = absoluteUrl(path);
  return {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline: post.title.slice(0, MAX_HEADLINE),
    description: post.excerpt,
    image: [postImage(post.imageUrl)],
    datePublished: post.createdAt,
    dateModified: post.updatedAt,
    inLanguage: locale,
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    author: post.author
      ? { "@type": "Person", name: post.author }
      : organization(),
    publisher: organization(),
  };
}

/** BreadcrumbList from ordered {name, path} crumbs (path = locale-prefixed). */
export function breadcrumbLd(items: { name: string; path: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: absoluteUrl(item.path),
    })),
  };
}
