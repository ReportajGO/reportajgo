import { setRequestLocale, getTranslations } from "next-intl/server";
import AdForm from "@/components/admin/AdForm";

export default async function NewAdPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("admin");

  return (
    <div>
      <h1 className="mb-6 font-display text-2xl font-extrabold tracking-tight">
        {t("ads.new")}
      </h1>
      <AdForm />
    </div>
  );
}
