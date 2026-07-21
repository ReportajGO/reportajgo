"use client";

import { useEffect, useState, type ReactNode } from "react";

/**
 * Wraps the pinned top zone (ticker + header + nav). Once the page is scrolled
 * past a few pixels it flags `data-scrolled`, letting the header and nav
 * condense to a slimmer bar via `group-data-[scrolled=true]/top:` variants on
 * their own classes (the styling stays with each component).
 */
export default function StickyTop({ children }: { children: ReactNode }) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll(); // reflect the position on mount (e.g. after a reload mid-page)
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div data-scrolled={scrolled} className="group/top sticky top-0 z-40">
      {children}
    </div>
  );
}
