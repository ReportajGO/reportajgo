import { notFound } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { getPostsByCategory } from "@/lib/posts";
import { isCategory } from "@/lib/constants";
import LeadStory from "@/components/LeadStory";
import SideItem from "@/components/SideItem";
import NewsCard from "@/components/NewsCard";
import AdSlot from "@/components/AdSlot";

export const dynamic = "force-dynamic";

export default async function CategoryPage({
  params,
}: {
  params: Promise<{ locale: string; category: string }>;
}) {
  const { locale, category } = await params;
  if (!isCategory(category)) notFound();
  setRequestLocale(locale);

  const [posts, tNav, tHome] = await Promise.all([
    getPostsByCategory(locale, category),
    getTranslations("nav"),
    getTranslations("home"),
  ]);

  const name = tNav(category);

  return (
    <div className="pb-4">
      <div className="mt-7 flex items-center gap-2.5 font-display text-xs font-extrabold uppercase tracking-[.14em] text-brand-red">
        <span className="h-[3px] w-[22px] rounded-sm bg-brand-red" />
        {tNav("home")} · {name}
      </div>

      {posts.length === 0 ? (
        <div className="py-24 text-center font-display">
          <b className="mb-2 block text-2xl text-ink">{name}</b>
          <p className="text-ink-soft">No posts here yet.</p>
        </div>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-1 items-start gap-6 lg:grid-cols-[1.65fr_1fr]">
            <LeadStory post={posts[0]} />
            {posts.length > 1 && (
              <aside>
                <div className="mb-2 flex items-center gap-2.5 font-display text-xs font-extrabold uppercase tracking-[.14em] text-brand-red">
                  <span className="h-[3px] w-[22px] rounded-sm bg-brand-red" />
                  {tHome("trending")}
                </div>
                <div className="flex flex-col border-t-2 border-ink">
                  {posts.slice(1, 5).map((p) => (
                    <SideItem key={p.id} post={p} />
                  ))}
                </div>
                <AdSlot variant="rectangle" className="mt-5" />
              </aside>
            )}
          </div>

          <div className="mb-4 mt-9">
            <h2 className="font-display text-[22px] font-extrabold tracking-tight">
              {name}
            </h2>
          </div>
          <div className="grid grid-cols-1 gap-[22px] sm:grid-cols-2 lg:grid-cols-4">
            {posts.map((p) => (
              <NewsCard key={p.id} post={p} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
