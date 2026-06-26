"use client";

import { useLocale } from "next-intl";
import { useTransition } from "react";
import { usePathname, useRouter } from "@/i18n/navigation";
import { locales, type Locale } from "@/i18n/routing";

export default function LangSwitcher() {
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function switchTo(next: Locale) {
    if (next === locale) return;
    startTransition(() => {
      router.replace(pathname, { locale: next });
    });
  }

  return (
    <div
      className="inline-flex w-fit shrink-0 rounded-full border border-line bg-bg-sub p-[3px] font-display"
      aria-busy={pending}
    >
      {locales.map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => switchTo(l)}
          className={`rounded-full px-2 py-[5px] text-[11px] font-bold uppercase tracking-wide transition-colors sm:px-[11px] sm:py-[6px] sm:text-xs ${
            l === locale
              ? "bg-brand-red text-white"
              : "text-ink-soft hover:text-ink"
          }`}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
