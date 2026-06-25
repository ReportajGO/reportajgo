"use client";

import { signOut } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useLocale } from "next-intl";

export default function SignOutButton() {
  const t = useTranslations("admin");
  const locale = useLocale();
  return (
    <button
      type="button"
      onClick={() => signOut({ callbackUrl: `/${locale}/login` })}
      className="rounded-full border border-line px-4 py-2 font-display text-sm font-bold text-ink-soft transition-colors hover:border-brand-red hover:text-brand-red"
    >
      {t("signOut")}
    </button>
  );
}
