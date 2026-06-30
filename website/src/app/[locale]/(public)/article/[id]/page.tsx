import { notFound } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { recordView, getRelatedPosts } from "@/lib/posts";
import { wordFor } from "@/lib/constants";
import { splitLeadingEmoji } from "@/lib/title";
import Cover from "@/components/Cover";
import Meta from "@/components/Meta";
import NewsCard from "@/components/NewsCard";
import ShareBar from "@/components/ShareBar";
import AdSlot from "@/components/AdSlot";

export const dynamic = "force-dynamic";

export default async function ArticlePage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  // Count this read and render with the fresh view total.
  const post = await recordView(id, locale);
  if (!post || !post.published || post.cleared) notFound();

  const t = await getTranslations("article");

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
      <article className="mx-auto max-w-[760px] py-6 sm:py-9">
        <div className="mb-3">
          <Meta
            categoryName={post.categoryName}
            createdAt={post.createdAt}
            readMin={readMin}
            views={post.views}
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
        <AdSlot variant="banner" className="my-7" />

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
