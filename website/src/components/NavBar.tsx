"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";

type NavTheme = { slug: string; name: string };

export default function NavBar({ themes }: { themes: NavTheme[] }) {
  const t = useTranslations("nav");
  const pathname = usePathname();

  function isActive(href: string) {
    return pathname === href;
  }

  const items = [
    { href: "/", name: t("home") },
    ...themes.map((theme) => ({ href: `/${theme.slug}`, name: theme.name })),
  ];

  return (
    <nav className="border-b border-line bg-bg">
      <div className="mx-auto max-w-page px-4 sm:px-[22px]">
        <div className="flex gap-1 overflow-x-auto font-display [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`whitespace-nowrap border-b-[3px] px-3 pb-2.5 pt-3 text-[14px] font-bold transition-colors sm:px-3.5 sm:pb-3 sm:pt-3.5 sm:text-[14.5px] ${
                isActive(item.href)
                  ? "border-brand-red text-ink"
                  : "border-transparent text-ink-soft hover:text-ink"
              }`}
            >
              {item.name}
            </Link>
          ))}
        </div>
      </div>
    </nav>
  );
}
