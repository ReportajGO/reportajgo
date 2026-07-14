import { notFound } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { getAdById } from "@/lib/ads";
import AdForm, { type AdFormData } from "@/components/admin/AdForm";

/** Format a Date into the "YYYY-MM-DDTHH:mm" value a datetime-local input wants. */
function toLocalInput(d: Date | null): string {
  if (!d) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default async function EditAdPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const [ad, t] = await Promise.all([getAdById(id), getTranslations("admin")]);
  if (!ad) notFound();

  const initial: AdFormData = {
    id: ad.id,
    title: ad.title,
    slot: ad.slot,
    imageUrl: ad.imageUrl,
    linkUrl: ad.linkUrl ?? "",
    published: ad.published,
    order: ad.order,
    startsAt: toLocalInput(ad.startsAt),
    endsAt: toLocalInput(ad.endsAt),
  };

  return (
    <div>
      <h1 className="mb-6 font-display text-2xl font-extrabold tracking-tight">
        {t("ads.edit")}
      </h1>
      <AdForm initial={initial} />
    </div>
  );
}
