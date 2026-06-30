import { setRequestLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getPosts } from "@/lib/posts";
import { rankPosts, suggestSpelling } from "@/lib/search";
import NewsCard from "@/components/NewsCard";

export const dynamic = "force-dynamic";

export default async function SearchPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { locale } = await params;
  const { q = "" } = await searchParams;
  setRequestLocale(locale);

  const t = await getTranslations("search");
  const query = q.trim();

  const posts = await getPosts(locale);
  const hits = rankPosts(posts, query);
  const didYouMean = hits.length === 0 && query ? suggestSpelling(posts, query) : null;
  const trending = [...posts].sort((a, b) => b.views - a.views).slice(0, 8);

  return (
    <div className="pb-6">
      <div className="mb-5 mt-8">
        <h2 className="font-display text-[22px] font-extrabold tracking-tight">
          {t("results")} “{query}” · {hits.length}
        </h2>
      </div>

      {hits.length > 0 ? (
        <div className="grid grid-cols-1 gap-[22px] sm:grid-cols-2 lg:grid-cols-4">
          {hits.map((p) => (
            <NewsCard key={p.id} post={p} />
          ))}
        </div>
      ) : (
        <div>
          <div className="py-14 text-center font-display">
            <b className="mb-1.5 block text-2xl text-ink">{t("empty")}</b>
            {didYouMean ? (
              <p className="text-ink-soft">
                {t.rich("didYouMeanLink", {
                  link: (chunks) => (
                    <Link
                      href={`/search?q=${encodeURIComponent(didYouMean)}`}
                      className="font-bold text-brand-red hover:underline"
                    >
                      {chunks}
                    </Link>
                  ),
                  term: didYouMean,
                })}
              </p>
            ) : (
              <p className="text-ink-soft">{t("emptySub")}</p>
            )}
          </div>

          {trending.length > 0 && (
            <section className="mt-2">
              <div className="mb-4 flex items-center gap-2.5 font-display text-xs font-extrabold uppercase tracking-[.14em] text-brand-red">
                <span className="h-[3px] w-[22px] rounded-sm bg-brand-red" />
                {t("trendingLabel")}
              </div>
              <div className="grid grid-cols-1 gap-[22px] sm:grid-cols-2 lg:grid-cols-4">
                {trending.map((p) => (
                  <NewsCard key={p.id} post={p} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
