"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import Logo from "./Logo";
import SearchBox from "./SearchBox";
import LangSwitcher from "./LangSwitcher";
import ThemeToggle from "./ThemeToggle";
import SocialLinks from "./SocialLinks";

type NavTheme = { slug: string; name: string };

export default function Header({ themes }: { themes: NavTheme[] }) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);

  return (
    <header className="border-b border-line bg-bg/90 backdrop-blur-md backdrop-saturate-150">
      <div className="mx-auto flex max-w-page items-center gap-2 px-4 py-2.5 sm:gap-4 sm:px-[22px] sm:py-3.5">
        <div className="flex min-w-0 flex-col">
          <Logo size="md" />
          <span className="mt-0.5 hidden font-display text-[11px] font-semibold uppercase tracking-[.12em] text-brand-red sm:block">
            {t("brand.slogan")}
          </span>
        </div>

        <div className="flex-1" />

        <SearchBox className="hidden min-w-[210px] max-w-[300px] flex-1 md:flex" />
        <LangSwitcher />
        <ThemeToggle />

        {/* hamburger */}
        <button
          type="button"
          aria-label={t("header.openMenu")}
          onClick={() => setOpen((v) => !v)}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-line bg-bg-sub text-ink transition-colors hover:border-brand-red sm:h-10 sm:w-10 md:hidden"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            {open ? (
              <path d="M6 6l12 12M18 6L6 18" />
            ) : (
              <path d="M3 6h18M3 12h18M3 18h18" />
            )}
          </svg>
        </button>
      </div>

      {/* mobile drawer */}
      {open && (
        <div className="border-t border-line bg-bg px-[22px] py-3 md:hidden">
          <SearchBox className="mb-3" />
          <div className="flex flex-col">
            <Link
              href="/"
              onClick={() => setOpen(false)}
              className="border-b border-line py-2.5 font-display font-bold text-ink"
            >
              {t("nav.home")}
            </Link>
            {themes.map((theme) => (
              <Link
                key={theme.slug}
                href={`/${theme.slug}`}
                onClick={() => setOpen(false)}
                className="border-b border-line py-2.5 font-display font-bold text-ink"
              >
                {theme.name}
              </Link>
            ))}
          </div>
          <SocialLinks className="mt-4" />
        </div>
      )}
    </header>
  );
}
