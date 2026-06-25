import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import Logo from "@/components/Logo";

export default async function NotFound() {
  const t = await getTranslations("article");
  return (
    <main className="grid min-h-screen place-items-center bg-bg px-5 text-center">
      <div>
        <Logo size="lg" />
        <p className="mt-6 font-display text-6xl font-black text-brand-red">404</p>
        <p className="mt-2 font-display text-ink-soft">{t("notFound")}</p>
        <Link
          href="/"
          className="mt-6 inline-block rounded-lg bg-brand-red px-5 py-2.5 font-display text-sm font-bold text-white"
        >
          ← {t("back")}
        </Link>
      </div>
    </main>
  );
}
