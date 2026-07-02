import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { authOptions } from "@/lib/auth";
import Logo from "@/components/Logo";
import AdminProviders from "@/components/admin/AdminProviders";
import AdminNav from "@/components/admin/AdminNav";
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
      <div className="min-h-screen bg-bg-sub lg:flex">
        {/* Sidebar (desktop) */}
        <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-line bg-bg px-4 py-5 lg:flex">
          <div className="mb-6 px-1">
            <Logo size="sm" href="/admin" />
          </div>
          <span className="mb-2 px-3 font-display text-[11px] font-extrabold uppercase tracking-[.12em] text-ink-soft">
            {t("title")}
          </span>
          <AdminNav variant="side" />
          <div className="mt-auto flex flex-col gap-1 border-t border-line pt-4">
            <Link
              href="/"
              className="rounded-xl px-3 py-2.5 font-display text-sm font-bold text-ink-soft transition-colors hover:bg-bg-sub hover:text-ink"
            >
              ← {t("backToSite")}
            </Link>
            <SignOutButton />
          </div>
        </aside>

        {/* Mobile top bar */}
        <header className="border-b border-line bg-bg lg:hidden">
          <div className="flex items-center gap-3 px-4 py-3">
            <Logo size="sm" />
            <div className="flex-1" />
            <Link href="/" className="font-display text-sm font-bold text-ink-soft hover:text-brand-red">
              {t("backToSite")} →
            </Link>
            <SignOutButton />
          </div>
          <div className="border-t border-line px-3 py-2">
            <AdminNav variant="top" />
          </div>
        </header>

        {/* Content */}
        <main className="min-w-0 flex-1 px-4 py-6 sm:px-7 sm:py-8">
          <div className="mx-auto max-w-5xl">{children}</div>
        </main>
      </div>
    </AdminProviders>
  );
}
