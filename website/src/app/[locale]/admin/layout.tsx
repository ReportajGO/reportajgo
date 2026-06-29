import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { authOptions } from "@/lib/auth";
import Logo from "@/components/Logo";
import AdminProviders from "@/components/admin/AdminProviders";
import SignOutButton from "@/components/admin/SignOutButton";

export default async function AdminLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await getServerSession(authOptions);
  if (!session) redirect(`/${locale}/login`);

  const t = await getTranslations("admin");

  return (
    <AdminProviders>
      <div className="min-h-screen bg-bg-sub">
        <header className="border-b border-line bg-bg">
          <div className="mx-auto flex max-w-page items-center gap-3 px-4 py-3.5 sm:gap-4 sm:px-[22px]">
            <Logo size="sm" />
            <span className="hidden font-display text-sm font-bold text-ink-soft sm:block">
              {t("title")}
            </span>
            <div className="flex-1" />
            <Link
              href="/"
              className="font-display text-sm font-bold text-ink-soft hover:text-brand-red"
            >
              {t("backToSite")} →
            </Link>
            <SignOutButton />
          </div>
        </header>
        <main className="mx-auto max-w-page px-4 py-6 sm:px-[22px] sm:py-8">{children}</main>
      </div>
    </AdminProviders>
  );
}
