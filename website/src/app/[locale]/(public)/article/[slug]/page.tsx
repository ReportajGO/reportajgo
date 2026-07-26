import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import {
  recordView,
  getRelatedPosts,
  getPostById,
  resolvePostRef,
} from "@/lib/posts";
import { wordFor } from "@/lib/constants";
import { splitLeadingEmoji } from "@/lib/title";
import { buildAlternates } from "@/lib/seo";
import { newsArticleLd, breadcrumbLd } from "@/lib/jsonld";
import JsonLd from "@/components/JsonLd";
import Cover from "@/components/Cover";
import Meta from "@/components/Meta";
import NewsCard from "@/components/NewsCard";
import ShareBar from "@/components/ShareBar";
import AdSlot from "@/components/AdSlot";

export const dynamic = "force-dynamic";

type ArticleParams = { locale: string; slug: string };

/**
 * SEO metadata: real title/description plus a canonical URL, so search consoles
 * index the pretty slug (and treat the legacy id URL as a duplicate of it).
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<ArticleParams>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  const ref = await resolvePostRef(slug);
  if (!ref) return {};
  const post = await getPostById(ref.id, locale);
  if (!post || !post.published || post.cleared) return {};

  const pathNoLocale = `/article/${ref.slug ?? ref.id}`;
  const canonical = `/${locale}${pathNoLocale}`;
  // Always emit an og:image (overriding openGraph drops the layout default, so
  // fall back to the branded card for image-less posts).
  const image = post.imageUrl ?? "/og-default.png";
  return {
    title: post.title,
    description: post.excerpt,
    alternates: buildAlternates(locale, pathNoLocale), // canonical + hreflang siblings
    openGraph: {
      type: "article",
      title: post.title,
      description: post.excerpt,
      url: canonical,
      images: [image],
      publishedTime: post.createdAt,
      modifiedTime: post.updatedAt,
    },
    twitter: {
      card: "summary_large_image",
      title: post.title,
      description: post.excerpt,
      images: [image],
    },
  };
}

export default async function ArticlePage({
  params,
}: {
  params: Promise<ArticleParams>;
}) {
  const { locale, slug } = await params;
  setRequestLocale(locale);

  // Resolve the URL segment (pretty slug or a legacy cuid) to a post.
  const ref = await resolvePostRef(slug);
  if (!ref) notFound();
  // Send legacy id links (or any non-canonical segment) to the slug URL with a
  // permanent redirect so shared links and search-engine equity carry over.
  if (ref.slug && ref.slug !== slug) {
    permanentRedirect(`/${locale}/article/${ref.slug}`);
  }

  // Count this read and render with the fresh view total.
  const post = await recordView(ref.id, locale);
  if (!post || !post.published || post.cleared) notFound();

  const [t, tNav] = await Promise.all([
    getTranslations("article"),
    getTranslations("nav"),
  ]);

  const articlePath = `/${locale}/article/${post.slug}`;

  const paragraphs = post.body
    .split(/\n{2,}|\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const words = post.body.split(/\s+/).filter(Boolean).length;
  const readMin = Math.max(2, Math.round(words / 120));

  const initials = (post.author ?? "RG")
    .split(/[ .]/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0])
    .join("")
    .toUpperCase();

  const related = await getRelatedPosts(locale, post, 4);

  const { emoji, text: titleText } = splitLeadingEmoji(post.title);

  // Cover proportion chosen in admin. Square/portrait are centered and
  // width-capped so they don't dominate the reading column.
  const coverClass =
    post.aspect === "1:1"
      ? "mx-auto aspect-square w-full max-w-[520px]"
      : post.aspect === "4:5"
        ? "mx-auto aspect-[4/5] w-full max-w-[440px]"
        : "aspect-[16/9] w-full";

  return (
    <>
      <JsonLd
        data={[
          newsArticleLd(post, locale, articlePath),
          breadcrumbLd([
            { name: tNav("home"), path: `/${locale}` },
            { name: post.categoryName, path: `/${locale}/${post.category}` },
            { name: post.title, path: articlePath },
          ]),
        ]}
      />
      <article className="mx-auto max-w-[760px] py-6 sm:py-9">
        <div className="mb-3">
          <Meta
            categoryName={post.categoryName}
            createdAt={post.createdAt}
            readMin={readMin}
          />
        </div>
        <h1 className="mb-3 font-serif text-[26px] font-bold leading-[1.12] tracking-tight sm:text-[36px] sm:leading-[1.09] lg:text-[44px] lg:leading-[1.07]">
          {emoji && (
            <span className="mr-2 align-[0.06em] text-[0.72em]">{emoji}</span>
          )}
          {titleText}
        </h1>
        <p className="mb-5 text-[17px] leading-snug text-ink-soft sm:text-[20px] lg:text-[22px]">
          {post.excerpt}
        </p>

        <Cover
          category={post.category}
          imageUrl={post.imageUrl}
          variant="lead"
          className={`mb-3 ${coverClass}`}
        />
        <p className="mb-6 font-mono text-xs text-ink-soft">
          ReportajGO · {wordFor(post.category)}
        </p>

        <div className="mb-6 flex items-center gap-3 border-y border-line py-3.5">
          <div className="grid h-[42px] w-[42px] place-items-center rounded-full bg-brand-red font-display text-base font-extrabold text-white">
            {initials}
          </div>
          <div>
            <div className="font-display text-[15px] font-extrabold">
              {post.author ?? "ReportajGO"}
            </div>
            <div className="font-mono text-[11px] text-ink-soft">
              {t("by")} · ReportajGO
            </div>
          </div>
        </div>

        <div className="article-body">
          {paragraphs.map((p, i) => (
            <p
              key={i}
              className="mb-5 text-[17px] leading-[1.7] text-ink sm:text-[18px] sm:leading-[1.68] lg:text-[19.5px] lg:leading-[1.65]"
            >
              {p}
            </p>
          ))}
        </div>

        {/* Photo gallery (extra images attached in admin) */}
        {post.gallery.length > 0 && (
          <div className="mt-8">
            <h2 className="mb-3 font-display text-lg font-extrabold tracking-tight">
              {t("gallery")}
            </h2>
            <div className="grid grid-cols-2 gap-2 sm:gap-3">
              {post.gallery.map((src, i) => (
                <a
                  key={i}
                  href={src}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group block overflow-hidden rounded-xl border border-line"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={src}
                    alt={`${titleText} — ${i + 1}`}
                    loading="lazy"
                    className="aspect-[4/3] w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
                  />
                </a>
              ))}
            </div>
          </div>
        )}

        {/* In-article ad */}
        <AdSlot slot="article-banner" className="my-7" />

        <ShareBar
          title={post.title}
          shareLabel={t("share")}
          copyLabel={t("copy")}
          copiedLabel={t("copied")}
        />

        <Link
          href="/"
          className="mt-5 inline-flex items-center gap-2 font-display text-sm font-bold text-brand-red"
        >
          ← {t("back")}
        </Link>
      </article>

      {related.length > 0 && (
        <section className="-mx-[22px] mt-12 border-y border-line bg-bg-sub px-[22px] pb-10 pt-2">
          <div className="mx-auto max-w-page">
            <div className="mb-4 mt-6">
              <h2 className="font-display text-[22px] font-extrabold tracking-tight">
                {t("related")}
              </h2>
            </div>
            <div className="grid grid-cols-1 gap-[22px] sm:grid-cols-2 lg:grid-cols-4">
              {related.map((p) => (
                <NewsCard key={p.id} post={p} />
              ))}
            </div>
          </div>
        </section>
      )}
    </>
  );
}
