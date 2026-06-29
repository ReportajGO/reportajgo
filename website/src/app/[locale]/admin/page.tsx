import { setRequestLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getAllPostsAdmin } from "@/lib/posts";
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

  const [posts, t, tNav, tTime] = await Promise.all([
    getAllPostsAdmin(),
    getTranslations("admin"),
    getTranslations("nav"),
    getTranslations("time"),
  ]);

  const rows = posts.map((p) => {
    const rel = relativeTime(p.createdAt);
    const when = rel.unit === "just" ? tTime("just") : `${rel.value} ${tTime(rel.unit)}`;
    return { post: p, when };
  });

  return (
    <div>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="font-display text-2xl font-extrabold tracking-tight">
          {t("dashboard")}{" "}
          <span className="text-ink-soft">· {posts.length}</span>
        </h1>
        <Link
          href="/admin/new"
          className="rounded-lg bg-brand-red px-4 py-2.5 text-center font-display text-sm font-bold text-white transition-opacity hover:opacity-90"
        >
          + {t("newPost")}
        </Link>
      </div>

      {posts.length === 0 ? (
        <div className="rounded-2xl border border-line bg-surface py-20 text-center font-display text-ink-soft">
          {t("noPosts")}
        </div>
      ) : (
        <>
          {/* Mobile: card list (the table doesn't fit narrow phone widths) */}
          <ul className="space-y-3 sm:hidden">
            {rows.map(({ post: p, when }) => (
              <li
                key={p.id}
                className="rounded-xl border border-line bg-surface p-4"
              >
                <div className="mb-2 flex items-start gap-2">
                  {p.breaking && (
                    <span className="mt-0.5 shrink-0 rounded bg-brand-red px-1.5 py-0.5 text-[10px] font-bold text-white">
                      BR
                    </span>
                  )}
                  <span className="line-clamp-2 flex-1 font-display font-semibold">
                    {p.title}
                  </span>
                </div>
                <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 font-display text-xs text-ink-soft">
                  <span>{tNav(p.category)}</span>
                  <span aria-hidden>·</span>
                  <span className="uppercase">{p.language}</span>
                  <span aria-hidden>·</span>
                  <span>{when}</span>
                </div>
                <div className="flex items-center gap-5 border-t border-line pt-3">
                  <Link
                    href={`/admin/${p.id}/edit`}
                    className="font-display text-sm font-bold text-brand-red hover:underline"
                  >
                    {t("actions.edit")}
                  </Link>
                  <DeleteButton id={p.id} />
                </div>
              </li>
            ))}
          </ul>

          {/* Desktop: table */}
          <div className="hidden overflow-hidden rounded-2xl border border-line bg-surface sm:block">
            <table className="w-full text-left font-display text-sm">
              <thead className="border-b border-line bg-bg-sub text-xs uppercase tracking-wide text-ink-soft">
                <tr>
                  <th className="px-4 py-3">{t("table.title")}</th>
                  <th className="px-4 py-3">{t("table.category")}</th>
                  <th className="px-4 py-3">{t("table.lang")}</th>
                  <th className="px-4 py-3">{t("table.date")}</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {rows.map(({ post: p, when }) => (
                  <tr key={p.id} className="border-b border-line last:border-0">
                    <td className="max-w-xs px-4 py-3">
                      <span className="line-clamp-1 font-semibold">
                        {p.breaking && (
                          <span className="mr-1.5 rounded bg-brand-red px-1.5 py-0.5 text-[10px] font-bold text-white">
                            BR
                          </span>
                        )}
                        {p.title}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-ink-soft">{tNav(p.category)}</td>
                    <td className="px-4 py-3 uppercase text-ink-soft">
                      {p.language}
                    </td>
                    <td className="px-4 py-3 text-ink-soft">{when}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-3">
                        <Link
                          href={`/admin/${p.id}/edit`}
                          className="font-bold text-brand-red hover:underline"
                        >
                          {t("actions.edit")}
                        </Link>
                        <DeleteButton id={p.id} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
