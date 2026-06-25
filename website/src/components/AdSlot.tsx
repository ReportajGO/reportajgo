import { getTranslations } from "next-intl/server";

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
      <span className="font-mono text-[11px] opacity-50">320×100 · 728×90</span>
    </aside>
  );
}
