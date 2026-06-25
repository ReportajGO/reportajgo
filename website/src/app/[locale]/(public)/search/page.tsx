import { setRequestLocale, getTranslations } from "next-intl/server";
import { getPosts } from "@/lib/posts";
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
  const query = q.trim().toLowerCase();

  const posts = await getPosts(locale);
  const hits = query
    ? posts.filter((p) =>
        `${p.title} ${p.excerpt} ${p.body}`.toLowerCase().includes(query),
      )
    : [];

  return (
    <div className="pb-6">
      <div className="mb-5 mt-8">
        <h2 className="font-display text-[22px] font-extrabold tracking-tight">
          {t("results")} “{q}” · {hits.length}
        </h2>
      </div>

      {hits.length > 0 ? (
        <div className="grid grid-cols-1 gap-[22px] sm:grid-cols-2 lg:grid-cols-4">
          {hits.map((p) => (
            <NewsCard key={p.id} post={p} />
          ))}
        </div>
      ) : (
        <div className="py-24 text-center font-display">
          <b className="mb-1.5 block text-2xl text-ink">{t("empty")}</b>
          <p className="text-ink-soft">{t("emptySub")}</p>
        </div>
      )}
    </div>
  );
}
