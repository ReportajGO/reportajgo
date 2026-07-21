"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * Records one page view per navigation (fire-and-forget) for the admin audience
 * stats. Renders nothing. Failures are ignored — tracking never affects the UI.
 */
export default function VisitTracker() {
  const pathname = usePathname();

  useEffect(() => {
    fetch("/api/track", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: pathname }),
      keepalive: true,
    }).catch(() => {});
  }, [pathname]);

  return null;
}
