import { getServerSession } from "next-auth";
import { getTranslations } from "next-intl/server";
import { authOptions } from "@/lib/auth";

/**
 * Master switch for live ad slots. While `false`, regular visitors see nothing
 * (placements stay in the page), but a logged-in admin still sees the labelled
 * placeholders to preview where ads will appear. Flip to `true` (or drop in a
 * real ad tag) when ads go live for everyone.
 */
const ADS_ENABLED = false;

/**
 * Reusable advertising placeholder. Drop it anywhere a banner/box should go;
 * swap the inner markup for a real ad tag (AdSense, GAM, direct creative)
 * later — the sizing wrapper stays the same.
 *
 * Variants map to common ad formats and stay responsive:
 * - "leaderboard" → tall mobile banner → wide leaderboard on desktop
 * - "banner"      → in-feed / in-article horizontal strip
 * - "rectangle"   → 300×250-style box (sidebars)
 */
export default async function AdSlot({
  variant = "banner",
  className = "",
}: {
  variant?: "leaderboard" | "banner" | "rectangle";
  className?: string;
}) {
  // Hidden from the public until ads go live — but admins still preview them.
  if (!ADS_ENABLED) {
    const session = await getServerSession(authOptions);
    if (!session) return null;
  }

  const t = await getTranslations("ads");

  const size =
    variant === "leaderboard"
      ? "h-[100px] sm:h-[90px]"
      : variant === "rectangle"
        ? "h-[250px]"
        : "h-[110px] sm:h-[130px]";

  return (
    <aside
      aria-label={t("label")}
      className={`flex w-full flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-line bg-bg-sub text-ink-soft ${size} ${className}`}
    >
      <span className="font-display text-[10px] font-bold uppercase tracking-[.22em]">
        {t("label")}
      </span>
      <span className="font-mono text-[11px] opacity-50">
        {ADS_ENABLED ? "320×100 · 728×90" : "превью · видно только админу"}
      </span>
    </aside>
  );
}
