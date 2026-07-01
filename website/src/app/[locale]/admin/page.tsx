import { setRequestLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getAllPostsAdmin, getContentCounts } from "@/lib/posts";
import { getActiveThemes } from "@/lib/themes";
import { relativeTime } from "@/lib/time";
import AdminPostList, { type AdminPostRow } from "@/components/admin/AdminPostList";

export const dynamic = "force-dynamic";

export default async function AdminDashboard({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const [posts, counts, themes, t, tTime] = await Promise.all([
    getAllPostsAdmin(),
    getContentCounts(),
    getActiveThemes(locale),
    getTranslations("admin"),
    getTranslations("time"),
  ]);

  const rows: AdminPostRow[] = posts.map((p) => {
    const rel = relativeTime(p.createdAt);
    const when = rel.unit === "just" ? tTime("just") : `${rel.value} ${tTime(rel.unit)}`;
    return {
      id: p.id,
      title: p.title,
      imageUrl: p.imageUrl,
      categoryName: p.categoryName,
      language: p.language,
      cleared: p.cleared,
      breaking: p.breaking,
      when,
    };
  });

  const stats = [
    { label: t("stats.total"), value: posts.length },
    { label: t("stats.live"), value: counts.live },
    { label: t("stats.cleared"), value: counts.cleared },
    { label: t("stats.sections"), value: themes.length },
  ];

  return (
    <div>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="font-display text-2xl font-extrabold tracking-tight">
          {t("dashboard")}
        </h1>
        <Link
          href="/admin/new"
          className="rounded-lg bg-brand-red px-4 py-2.5 text-center font-display text-sm font-bold text-white transition-opacity hover:opacity-90"
        >
          + {t("newPost")}
        </Link>
      </div>

      {/* Stat cards */}
      <div className="mb-7 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-2xl border border-line bg-surface p-4">
            <div className="font-display text-3xl font-extrabold tracking-tight text-ink">
              {s.value}
            </div>
            <div className="mt-0.5 font-display text-xs font-bold uppercase tracking-wide text-ink-soft">
              {s.label}
            </div>
          </div>
        ))}
      </div>

      {posts.length === 0 ? (
        <div className="rounded-2xl border border-line bg-surface py-20 text-center font-display text-ink-soft">
          {t("noPosts")}
        </div>
      ) : (
        <AdminPostList rows={rows} />
      )}
    </div>
  );
}
