import { setRequestLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getPosts } from "@/lib/posts";
import { getActiveThemes } from "@/lib/themes";
import { postsForTheme } from "@/lib/search";
import LeadStory from "@/components/LeadStory";
import SideItem from "@/components/SideItem";
import NewsCard from "@/components/NewsCard";
import AdSlot from "@/components/AdSlot";

export const dynamic = "force-dynamic";

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const [posts, themes, tHome] = await Promise.all([
    getPosts(locale),
    getActiveThemes(locale),
    getTranslations("home"),
  ]);

  if (posts.length === 0) {
    return (
      <div className="py-24 text-center font-display">
        <b className="mb-2 block text-2xl text-ink">ReportajGO</b>
        <p className="text-ink-soft">
          No posts in this language yet. Add some in{" "}
          <Link href="/admin" className="text-brand-red underline">
            /admin
          </Link>
          .
        </p>
      </div>
    );
  }

  const lead = posts.find((p) => p.breaking) ?? posts[0];
  const rest = posts.filter((p) => p.id !== lead.id);
  const trending = rest.slice(0, 4);
  const latest = rest.slice(0, 4);

  return (
    <div className="pb-4">
      {/* Lead + trending */}
      <div className="mt-6 grid grid-cols-1 items-start gap-6 lg:grid-cols-[1.65fr_1fr]">
        <LeadStory post={lead} />
        <aside>
          <div className="mb-2 flex items-center gap-2.5 font-display text-xs font-extrabold uppercase tracking-[.14em] text-brand-red">
            <span className="h-[3px] w-[22px] rounded-sm bg-brand-red" />
            {tHome("trending")}
          </div>
          <div className="flex flex-col border-t-2 border-ink">
            {trending.map((p) => (
              <SideItem key={p.id} post={p} />
            ))}
          </div>
          <AdSlot variant="rectangle" className="mt-5" />
        </aside>
      </div>

      {/* In-feed ad banner */}
      <AdSlot variant="banner" className="mt-9" />

      {/* Latest */}
      <div className="mb-4 mt-9 flex items-center justify-between">
        <h2 className="font-display text-[22px] font-extrabold tracking-tight">
          {tHome("latest")}
        </h2>
      </div>
      <div className="grid grid-cols-1 gap-[22px] sm:grid-cols-2 lg:grid-cols-4">
        {latest.map((p) => (
          <NewsCard key={p.id} post={p} />
        ))}
      </div>

      {/* Theme bands (one per active topic filter) — each shows news related to
          the filter, not just the articles primarily assigned to it. */}
      {themes.map((theme) => {
        const items = postsForTheme(posts, theme).slice(0, 4);
        if (items.length === 0) return null;
        return (
          <section
            key={theme.slug}
            className="-mx-[22px] mt-12 border-y border-line bg-bg-sub px-[22px] pb-10 pt-2"
          >
            <div className="mx-auto max-w-page">
              <div className="mb-4 mt-6 flex items-center justify-between">
                <h2 className="font-display text-[22px] font-extrabold tracking-tight">
                  {theme.name}
                </h2>
                <Link
                  href={`/${theme.slug}`}
                  className="font-display text-xs font-extrabold uppercase tracking-[.14em] text-brand-red"
                >
                  {tHome("seeAll")}
                </Link>
              </div>
              <div className="grid grid-cols-1 gap-[22px] sm:grid-cols-2 lg:grid-cols-4">
                {items.map((p) => (
                  <NewsCard key={p.id} post={p} />
                ))}
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}
