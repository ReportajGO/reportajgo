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

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-display text-2xl font-extrabold tracking-tight">
          {t("dashboard")}{" "}
          <span className="text-ink-soft">· {posts.length}</span>
        </h1>
        <Link
          href="/admin/new"
          className="rounded-lg bg-brand-red px-4 py-2.5 font-display text-sm font-bold text-white transition-opacity hover:opacity-90"
        >
          + {t("newPost")}
        </Link>
      </div>

      {posts.length === 0 ? (
        <div className="rounded-2xl border border-line bg-surface py-20 text-center font-display text-ink-soft">
          {t("noPosts")}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-line bg-surface">
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
              {posts.map((p) => {
                const rel = relativeTime(p.createdAt);
                const when =
                  rel.unit === "just"
                    ? tTime("just")
                    : `${rel.value} ${tTime(rel.unit)}`;
                return (
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
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
