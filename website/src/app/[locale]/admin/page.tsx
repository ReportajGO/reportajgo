import Image from "next/image";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getAllPostsAdmin, getContentCounts } from "@/lib/posts";
import { getActiveThemes } from "@/lib/themes";
import { relativeTime } from "@/lib/time";
import DeleteButton from "@/components/admin/DeleteButton";

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

  const rows = posts.map((p) => {
    const rel = relativeTime(p.createdAt);
    const when = rel.unit === "just" ? tTime("just") : `${rel.value} ${tTime(rel.unit)}`;
    return { post: p, when };
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
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {rows.map(({ post: p, when }) => (
            <li
              key={p.id}
              className="flex gap-3 rounded-xl border border-line bg-surface p-3"
            >
              {/* Small thumbnail */}
              <div className="relative h-16 w-24 shrink-0 overflow-hidden rounded-lg bg-bg-sub">
                {p.imageUrl ? (
                  <Image
                    src={p.imageUrl}
                    alt=""
                    fill
                    sizes="96px"
                    className={`object-cover ${p.cleared ? "opacity-50 grayscale" : ""}`}
                  />
                ) : (
                  <div className="grid h-full w-full place-items-center text-ink-soft/50">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="18" height="18" rx="2" />
                      <circle cx="9" cy="9" r="2" />
                      <path d="m21 15-3.5-3.5L9 20" />
                    </svg>
                  </div>
                )}
                {p.breaking && (
                  <span className="absolute left-1 top-1 rounded bg-brand-red px-1 py-0.5 text-[9px] font-bold leading-none text-white">
                    BR
                  </span>
                )}
              </div>

              {/* Content */}
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex items-start gap-1.5">
                  {p.cleared && (
                    <span className="mt-0.5 shrink-0 rounded bg-ink-soft/20 px-1.5 py-0.5 text-[10px] font-bold uppercase text-ink-soft">
                      {t("clear.badge")}
                    </span>
                  )}
                  <span className={`line-clamp-2 font-display text-sm font-semibold leading-snug ${p.cleared ? "text-ink-soft line-through" : "text-ink"}`}>
                    {p.title}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 font-display text-xs text-ink-soft">
                  <span>{p.categoryName}</span>
                  <span aria-hidden>·</span>
                  <span className="uppercase">{p.language}</span>
                  <span aria-hidden>·</span>
                  <span>{when}</span>
                </div>
                <div className="mt-auto flex items-center gap-4 pt-2">
                  <Link
                    href={`/admin/${p.id}/edit`}
                    className="font-display text-xs font-bold text-brand-red hover:underline"
                  >
                    {t("actions.edit")}
                  </Link>
                  <DeleteButton id={p.id} />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
