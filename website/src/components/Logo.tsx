import Image from "next/image";
import { Link } from "@/i18n/navigation";

/**
 * RΞPORTAJ GO brand lockup, rendered from the logo image.
 *
 * Two artworks share the same red accents; only the wordmark color differs:
 * - /logo.png       → black "RΞPORTAJ" (for light surfaces)
 * - /logo-dark.png  → white "RΞPORTAJ" (for dark surfaces)
 *
 * Color selection:
 * - default → follows the page theme (black in light, white in dark), for
 *   surfaces whose background matches the theme (e.g. the header).
 * - `onDark` → always the white version, for constant-dark surfaces.
 * - `invert` → the OPPOSITE of the theme (white in light, black in dark), for
 *   surfaces whose background is inverted vs the theme — e.g. the footer
 *   (`bg-ink`), which is dark in light mode and light in dark mode.
 *
 * Height is responsive: smaller on phones, full size from the `sm` breakpoint
 * up. Width tracks the artwork aspect ratio (1304×394 ≈ 3.31:1).
 */
export default function Logo({
  size = "md",
  onDark = false,
  invert = false,
  href = "/",
}: {
  size?: "sm" | "md" | "lg";
  onDark?: boolean;
  invert?: boolean;
  /** Where the logo links. Defaults to the site home. */
  href?: string;
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
      href={href}
      aria-label="RΞPORTAJ GO"
      className="group inline-flex items-center"
    >
      {onDark ? (
        <Image src="/logo-dark.png" className={imgClass} {...common} />
      ) : (
        <>
          {/* light-theme view: black normally, white when inverted */}
          <Image
            src={invert ? "/logo-dark.png" : "/logo.png"}
            className={`${imgClass} dark:hidden`}
            {...common}
          />
          {/* dark-theme view: white normally, black when inverted */}
          <Image
            src={invert ? "/logo.png" : "/logo-dark.png"}
            className={`${imgClass} hidden dark:block`}
            {...common}
          />
        </>
      )}
    </Link>
  );
}
