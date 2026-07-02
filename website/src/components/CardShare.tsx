"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

/**
 * Compact per-card share control overlaid on a news card cover. Tapping it uses
 * the native share sheet when available (mobile); otherwise it opens a small
 * popover with X / Facebook / Telegram / copy-link — mirroring the article
 * ShareBar. Rendered as a sibling of the card link (never nested inside the
 * anchor) so its clicks don't trigger navigation.
 */
export default function CardShare({ id, title }: { id: string; title: string }) {
  const t = useTranslations("article");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  function articleUrl(): string {
    const origin = typeof window === "undefined" ? "" : window.location.origin;
    return `${origin}/${locale}/article/${id}`;
  }

  // Dismiss the popover on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    function onPointer(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function halt(e: React.MouseEvent) {
    // Stop the card link from navigating when the share UI is used.
    e.preventDefault();
    e.stopPropagation();
  }

  async function onTrigger(e: React.MouseEvent) {
    halt(e);
    const nav = typeof navigator !== "undefined" ? navigator : undefined;
    if (nav?.share) {
      try {
        await nav.share({ title, url: articleUrl() });
        return;
      } catch {
        /* user cancelled or unsupported at runtime — fall back to the popover */
      }
    }
    setOpen((o) => !o);
  }

  function openWin(href: string, e: React.MouseEvent) {
    halt(e);
    window.open(href, "_blank", "noopener,noreferrer,width=620,height=560");
    setOpen(false);
  }

  async function copy(e: React.MouseEvent) {
    halt(e);
    try {
      await navigator.clipboard.writeText(articleUrl());
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked — no-op */
    }
  }

  const u = () => encodeURIComponent(articleUrl());
  const tx = encodeURIComponent(title);

  const trigger =
    "grid h-9 w-9 place-items-center rounded-full bg-black/45 text-white backdrop-blur-sm " +
    "transition-colors hover:bg-brand-red focus-visible:bg-brand-red";
  const item =
    "grid h-9 w-9 place-items-center rounded-full border border-line bg-bg text-ink-soft " +
    "transition-colors hover:border-brand-red hover:text-brand-red";

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label={t("share")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={onTrigger}
        className={trigger}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx="18" cy="5" r="3" />
          <circle cx="6" cy="12" r="3" />
          <circle cx="18" cy="19" r="3" />
          <path d="M8.59 13.51l6.83 3.98M15.41 6.51l-6.82 3.98" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-11 z-20 flex items-center gap-1.5 rounded-full border border-line bg-bg p-1.5 shadow-lg"
        >
          <button
            type="button"
            aria-label="X (Twitter)"
            onClick={(e) => openWin(`https://twitter.com/intent/tweet?url=${u()}&text=${tx}`, e)}
            className={item}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77Z" />
            </svg>
          </button>
          <button
            type="button"
            aria-label="Facebook"
            onClick={(e) => openWin(`https://www.facebook.com/sharer/sharer.php?u=${u()}`, e)}
            className={item}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.69 4.53-4.69 1.31 0 2.68.24 2.68.24v2.97h-1.51c-1.49 0-1.96.93-1.96 1.89v2.25h3.33l-.53 3.49h-2.8V24C19.61 23.1 24 18.1 24 12.07Z" />
            </svg>
          </button>
          <button
            type="button"
            aria-label="Telegram"
            onClick={(e) => openWin(`https://t.me/share/url?url=${u()}&text=${tx}`, e)}
            className={item}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M11.94 0C5.35 0 0 5.37 0 12s5.35 12 11.94 12C18.54 24 24 18.63 24 12S18.54 0 11.94 0Zm5.5 8.18-1.84 8.7c-.13.62-.5.77-1.02.48l-2.82-2.08-1.36 1.31c-.15.15-.28.28-.57.28l.2-2.88 5.24-4.73c.23-.2-.05-.32-.35-.12l-6.48 4.08-2.79-.87c-.61-.19-.62-.61.13-.9l10.9-4.2c.5-.18.95.12.78.92Z" />
            </svg>
          </button>
          <button
            type="button"
            aria-label={copied ? t("copied") : t("copy")}
            onClick={copy}
            className={`${item} ${copied ? "border-brand-red text-brand-red" : ""}`}
          >
            {copied ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M20 6 9 17l-5-5" />
              </svg>
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
              </svg>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
