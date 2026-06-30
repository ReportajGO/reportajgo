"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";

type NavKey = "dashboard" | "newPost" | "sections" | "settings";

const ITEMS: { key: NavKey; href: string; icon: React.ReactNode }[] = [
  {
    key: "dashboard",
    href: "/admin",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="9" rx="1" /><rect x="14" y="3" width="7" height="5" rx="1" /><rect x="14" y="12" width="7" height="9" rx="1" /><rect x="3" y="16" width="7" height="5" rx="1" /></svg>
    ),
  },
  {
    key: "newPost",
    href: "/admin/new",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
    ),
  },
  {
    key: "sections",
    href: "/admin/sections",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l9 5-9 5-9-5 9-5Z" /><path d="M3 12l9 5 9-5M3 17l9 5 9-5" /></svg>
    ),
  },
  {
    key: "settings",
    href: "/admin/settings",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" /></svg>
    ),
  },
];

export default function AdminNav({ variant }: { variant: "side" | "top" }) {
  const t = useTranslations("admin.nav");
  const pathname = usePathname();

  function isActive(href: string) {
    if (href === "/admin") return pathname === "/admin";
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  if (variant === "top") {
    return (
      <nav className="flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {ITEMS.map((it) => (
          <Link
            key={it.key}
            href={it.href}
            className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 font-display text-sm font-bold transition-colors ${
              isActive(it.href)
                ? "bg-brand-red text-white"
                : "text-ink-soft hover:bg-bg-sub hover:text-ink"
            }`}
          >
            {it.icon}
            {t(it.key)}
          </Link>
        ))}
      </nav>
    );
  }

  return (
    <nav className="flex flex-col gap-1">
      {ITEMS.map((it) => (
        <Link
          key={it.key}
          href={it.href}
          className={`flex items-center gap-3 rounded-xl px-3 py-2.5 font-display text-sm font-bold transition-colors ${
            isActive(it.href)
              ? "bg-brand-red text-white"
              : "text-ink-soft hover:bg-bg-sub hover:text-ink"
          }`}
        >
          {it.icon}
          {t(it.key)}
        </Link>
      ))}
    </nav>
  );
}
