"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

const STORAGE_KEY = "rg-cookie-consent";

/**
 * Bottom cookie-consent banner. Shows once until the visitor chooses; the
 * decision ("all" | "necessary") is remembered in localStorage.
 */
export default function CookieConsent() {
  const t = useTranslations("cookies");
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) setShow(true);
    } catch {
      /* storage blocked — keep hidden */
    }
  }, []);

  function decide(value: "all" | "necessary") {
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch {
      /* ignore */
    }
    setShow(false);
  }

  if (!show) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 border-t border-line bg-bg/95 backdrop-blur-md">
      <div className="mx-auto flex max-w-page flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:px-[22px]">
        <p className="flex-1 font-display text-[13px] leading-snug text-ink-soft">
          🍪 {t("message")}
        </p>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => decide("necessary")}
            className="rounded-full border border-line px-4 py-2 font-display text-[13px] font-bold text-ink-soft transition-colors hover:border-brand-red hover:text-ink"
          >
            {t("reject")}
          </button>
          <button
            type="button"
            onClick={() => decide("all")}
            className="rounded-full bg-brand-red px-4 py-2 font-display text-[13px] font-bold text-white transition-opacity hover:opacity-90"
          >
            {t("accept")}
          </button>
        </div>
      </div>
    </div>
  );
}
