import { setRequestLocale, getTranslations } from "next-intl/server";
import { getContentCounts } from "@/lib/posts";
import ClearControls from "@/components/admin/ClearControls";

export const dynamic = "force-dynamic";

export default async function AdminSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const [counts, t] = await Promise.all([
    getContentCounts(),
    getTranslations("admin"),
  ]);

  return (
    <div>
      <h1 className="mb-6 font-display text-2xl font-extrabold tracking-tight">
        {t("settingsPage.title")}
      </h1>

      <div className="space-y-5">
        {/* Maintenance */}
        <section className="rounded-2xl border border-line bg-surface p-5">
          <h2 className="font-display text-lg font-extrabold text-ink">
            {t("settingsPage.maintenance")}
          </h2>
          <p className="mt-1 max-w-2xl font-display text-sm text-ink-soft">
            {t("settingsPage.maintenanceDesc")}
          </p>
          <div className="mt-4">
            <ClearControls live={counts.live} cleared={counts.cleared} />
          </div>
        </section>

        {/* Sections note */}
        <section className="rounded-2xl border border-line bg-surface p-5">
          <h2 className="font-display text-lg font-extrabold text-ink">
            {t("nav.sections")}
          </h2>
          <p className="mt-1 max-w-2xl font-display text-sm text-ink-soft">
            {t("settingsPage.sectionsNote")}
          </p>
        </section>
      </div>
    </div>
  );
}
