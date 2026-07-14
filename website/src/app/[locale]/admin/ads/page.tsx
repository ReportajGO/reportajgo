import { setRequestLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getAllAdsAdmin } from "@/lib/ads";
import AdminAdList, { type AdminAdRow } from "@/components/admin/AdminAdList";

export const dynamic = "force-dynamic";

export default async function AdminAdsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const [ads, t] = await Promise.all([getAllAdsAdmin(), getTranslations("admin")]);

  const rows: AdminAdRow[] = ads.map((a) => ({
    id: a.id,
    title: a.title,
    slot: a.slot,
    imageUrl: a.imageUrl,
    linkUrl: a.linkUrl,
    published: a.published,
    order: a.order,
    startsAt: a.startsAt ? a.startsAt.toISOString() : null,
    endsAt: a.endsAt ? a.endsAt.toISOString() : null,
  }));

  return (
    <div>
      <div className="mb-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="font-display text-2xl font-extrabold tracking-tight">{t("ads.title")}</h1>
        <Link
          href="/admin/ads/new"
          className="rounded-lg bg-brand-red px-4 py-2.5 text-center font-display text-sm font-bold text-white transition-opacity hover:opacity-90"
        >
          + {t("ads.new")}
        </Link>
      </div>
      <p className="mb-6 max-w-2xl font-display text-sm text-ink-soft">{t("ads.desc")}</p>

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-line bg-surface py-20 text-center font-display text-ink-soft">
          {t("ads.empty")}
        </div>
      ) : (
        <AdminAdList rows={rows} />
      )}
    </div>
  );
}
