"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { NAV_ORDER } from "@/lib/constants";

export default function NavBar() {
  const t = useTranslations("nav");
  const pathname = usePathname();

  function isActive(key: string) {
    if (key === "home") return pathname === "/";
    return pathname === `/${key}`;
  }

  return (
    <nav className="border-b border-line bg-bg">
      <div className="mx-auto max-w-page px-4 sm:px-[22px]">
        <div className="flex gap-1 overflow-x-auto font-display [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {NAV_ORDER.map((key) => (
            <Link
              key={key}
              href={key === "home" ? "/" : `/${key}`}
              className={`whitespace-nowrap border-b-[3px] px-3 pb-2.5 pt-3 text-[14px] font-bold transition-colors sm:px-3.5 sm:pb-3 sm:pt-3.5 sm:text-[14.5px] ${
                isActive(key)
                  ? "border-brand-red text-ink"
                  : "border-transparent text-ink-soft hover:text-ink"
              }`}
            >
              {t(key)}
            </Link>
          ))}
        </div>
      </div>
    </nav>
  );
}
