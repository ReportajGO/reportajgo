"use client";

import { useEffect, useState } from "react";

/**
 * Floating "scroll to top" control (bottom-right). Appears once the page is
 * scrolled down; tapping it smoothly scrolls back to the top.
 */
export default function AutoScrollButton() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > 400);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (!show) return null;

  return (
    <button
      type="button"
      aria-label="Scroll to top"
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      className="fixed bottom-5 right-4 z-40 grid h-12 w-12 place-items-center rounded-full border border-line bg-bg text-ink shadow-card transition-colors hover:border-brand-red hover:text-brand-red sm:bottom-6 sm:right-6"
    >
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="m17 18-5-5-5 5" />
        <path d="m17 11-5-5-5 5" />
      </svg>
    </button>
  );
}
