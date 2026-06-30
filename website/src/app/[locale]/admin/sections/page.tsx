import { setRequestLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getThemeStats } from "@/lib/themes";

export const dynamic = "force-dynamic";

export default async function AdminSectionsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const [stats, t] = await Promise.all([
    getThemeStats(locale),
    getTranslations("admin"),
  ]);

  return (
    <div>
      <h1 className="mb-1 font-display text-2xl font-extrabold tracking-tight">
        {t("sectionsPage.title")}{" "}
        <span className="text-ink-soft">· {stats.filter((s) => s.active).length}</span>
      </h1>
      <p className="mb-6 max-w-2xl font-display text-sm text-ink-soft">
        {t("sectionsPage.desc")}
      </p>

      {stats.length === 0 ? (
        <div className="rounded-2xl border border-line bg-surface py-16 text-center font-display text-ink-soft">
          {t("sectionsPage.empty")}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-line bg-surface">
          <table className="w-full text-left font-display text-sm">
            <thead className="border-b border-line bg-bg-sub text-xs uppercase tracking-wide text-ink-soft">
              <tr>
                <th className="px-4 py-3">{t("sectionsPage.name")}</th>
                <th className="hidden px-4 py-3 sm:table-cell">UZ · RU · EN</th>
                <th className="px-4 py-3 text-center">{t("sectionsPage.articles")}</th>
                <th className="px-4 py-3 text-right">{t("sectionsPage.status")}</th>
              </tr>
            </thead>
            <tbody>
              {stats.map((s) => (
                <tr key={s.slug} className="border-b border-line last:border-0">
                  <td className="px-4 py-3">
                    {s.active ? (
                      <Link
                        href={`/${s.slug}`}
                        className="font-semibold text-ink hover:text-brand-red"
                      >
                        {s.name}
                      </Link>
                    ) : (
                      <span className="font-semibold text-ink-soft">{s.name}</span>
                    )}
                    <div className="font-mono text-xs text-ink-soft">/{s.slug}</div>
                  </td>
                  <td className="hidden px-4 py-3 text-ink-soft sm:table-cell">
                    {s.labels.uz} · {s.labels.ru} · {s.labels.en}
                  </td>
                  <td className="px-4 py-3 text-center tabular-nums text-ink-soft">
                    {s.count}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {s.active ? (
                      <span className="inline-flex items-center gap-1.5 font-bold text-emerald-600">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                        {t("sectionsPage.active")}
                      </span>
                    ) : (
                      <span className="font-bold text-ink-soft">{t("sectionsPage.hidden")}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
