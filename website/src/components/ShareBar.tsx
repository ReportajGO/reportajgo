"use client";

import { useState } from "react";

/**
 * Article share row: real social icon buttons (X, Facebook, Telegram) that
 * open a prefilled share dialog, plus a "copy link" button with feedback.
 * Built client-side so it can read the live page URL and use the clipboard.
 */
export default function ShareBar({
  title,
  shareLabel,
  copyLabel,
  copiedLabel,
}: {
  title: string;
  shareLabel: string;
  copyLabel: string;
  copiedLabel: string;
}) {
  const [copied, setCopied] = useState(false);

  function url() {
    return typeof window === "undefined" ? "" : window.location.href;
  }

  function open(href: string) {
    window.open(href, "_blank", "noopener,noreferrer,width=620,height=560");
  }

  const u = () => encodeURIComponent(url());
  const t = encodeURIComponent(title);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url());
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked — no-op */
    }
  }

  const btn =
    "grid h-10 w-10 place-items-center rounded-full border border-line text-ink-soft transition-colors hover:border-brand-red hover:text-brand-red";

  return (
    <div className="mt-7 flex flex-wrap items-center gap-2.5 border-t border-line pt-5">
      <span className="mr-1 font-display text-xs font-bold uppercase tracking-[.08em] text-ink-soft">
        {shareLabel}
      </span>

      <button
        type="button"
        aria-label="X (Twitter)"
        onClick={() => open(`https://twitter.com/intent/tweet?url=${u()}&text=${t}`)}
        className={btn}
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77Z" />
        </svg>
      </button>

      <button
        type="button"
        aria-label="Facebook"
        onClick={() => open(`https://www.facebook.com/sharer/sharer.php?u=${u()}`)}
        className={btn}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.69 4.53-4.69 1.31 0 2.68.24 2.68.24v2.97h-1.51c-1.49 0-1.96.93-1.96 1.89v2.25h3.33l-.53 3.49h-2.8V24C19.61 23.1 24 18.1 24 12.07Z" />
        </svg>
      </button>

      <button
        type="button"
        aria-label="Telegram"
        onClick={() => open(`https://t.me/share/url?url=${u()}&text=${t}`)}
        className={btn}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M11.94 0C5.35 0 0 5.37 0 12s5.35 12 11.94 12C18.54 24 24 18.63 24 12S18.54 0 11.94 0Zm5.5 8.18-1.84 8.7c-.13.62-.5.77-1.02.48l-2.82-2.08-1.36 1.31c-.15.15-.28.28-.57.28l.2-2.88 5.24-4.73c.23-.2-.05-.32-.35-.12l-6.48 4.08-2.79-.87c-.61-.19-.62-.61.13-.9l10.9-4.2c.5-.18.95.12.78.92Z" />
        </svg>
      </button>

      <button
        type="button"
        aria-label={copied ? copiedLabel : copyLabel}
        onClick={copy}
        className={`${btn} ${copied ? "border-brand-red text-brand-red" : ""}`}
      >
        {copied ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M20 6 9 17l-5-5" />
          </svg>
        ) : (
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
          </svg>
        )}
      </button>

      {copied && (
        <span className="font-mono text-[11px] text-brand-red">{copiedLabel}</span>
      )}
    </div>
  );
}
