import Image from "next/image";
import { Link } from "@/i18n/navigation";

/**
 * RΞPORTAJ GO brand lockup, rendered from the logo image.
 *
 * Two artworks share the same red accents; only the wordmark color differs:
 * - /logo.png       → black "RΞPORTAJ" (for light surfaces)
 * - /logo-dark.png  → white "RΞPORTAJ" (for dark surfaces)
 *
 * `onDark` forces the white version (e.g. the always-dark footer). Otherwise
 * the version follows the site theme via Tailwind's class-based `dark:`
 * variant, so the header logo flips with the light/dark toggle.
 *
 * Height is responsive: smaller on phones, full size from the `sm` breakpoint
 * up. Width tracks the artwork aspect ratio (1304×394 ≈ 3.31:1).
 */
export default function Logo({
  size = "md",
  onDark = false,
}: {
  size?: "sm" | "md" | "lg";
  onDark?: boolean;
}) {
  // mobile height → desktop height (px), and the desktop width used as the
  // intrinsic dimension for next/image.
  const { hClass, deskH } =
    size === "lg"
      ? { hClass: "h-12 sm:h-[72px]", deskH: 72 }
      : size === "sm"
        ? { hClass: "h-8 sm:h-11", deskH: 44 }
        : { hClass: "h-10 sm:h-[60px]", deskH: 60 };
  const w = Math.round(deskH * 3.31);

  const imgClass = `${hClass} w-auto origin-left transition-transform duration-200 group-hover:scale-[1.04]`;
  const common = {
    alt: "RΞPORTAJ GO",
    width: w,
    height: deskH,
    priority: true,
    sizes: `${w}px`,
  };

  return (
    <Link
      href="/"
      aria-label="ReportajGO — home"
      className="group inline-flex items-center"
    >
      {onDark ? (
        <Image src="/logo-dark.png" className={imgClass} {...common} />
      ) : (
        <>
          {/* light theme → black wordmark */}
          <Image
            src="/logo.png"
            className={`${imgClass} dark:hidden`}
            {...common}
          />
          {/* dark theme → white wordmark */}
          <Image
            src="/logo-dark.png"
            className={`${imgClass} hidden dark:block`}
            {...common}
          />
        </>
      )}
    </Link>
  );
}
