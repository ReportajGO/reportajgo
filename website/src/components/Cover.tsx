import { colorFor, wordFor, type CategorySlug } from "@/lib/constants";

function shade(hex: string, p: number) {
  const n = parseInt(hex.slice(1), 16);
  const clamp = (x: number) => Math.max(0, Math.min(255, x + p));
  const r = clamp((n >> 16) & 255);
  const g = clamp((n >> 8) & 255);
  const b = clamp(n & 255);
  return `#${[r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Article cover. Uses the real image when provided, otherwise renders a
 * branded gradient tile with the section watermark (matches the prototype).
 */
export default function Cover({
  category,
  imageUrl,
  variant = "card",
  className = "",
}: {
  category: CategorySlug;
  imageUrl?: string | null;
  variant?: "lead" | "card" | "thumb";
  className?: string;
}) {
  const c = colorFor(category);
  const grad = `linear-gradient(135deg, ${c} 0%, ${shade(c, -32)} 100%)`;
  const word =
    variant === "lead"
      ? "text-[88px] sm:text-[120px] lg:text-[150px]"
      : variant === "thumb"
        ? "text-[38px]"
        : "text-[84px]";

  return (
    <div
      className={`relative flex items-end overflow-hidden rounded-xl text-white ${className}`}
      style={
        imageUrl
          ? { backgroundImage: `url(${imageUrl})`, backgroundSize: "cover", backgroundPosition: "center" }
          : { backgroundImage: grad }
      }
    >
      {/* overlay sheen + bottom shade */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_120%_at_100%_0%,rgba(255,255,255,.22),transparent_55%),linear-gradient(180deg,rgba(0,0,0,0)_30%,rgba(0,0,0,.5)_100%)]" />
      {!imageUrl && (
        <span
          aria-hidden
          className={`pointer-events-none absolute -bottom-4 -right-1.5 font-display font-black uppercase leading-[.8] tracking-[-.04em] text-white/[.16] ${word}`}
        >
          {wordFor(category)}
        </span>
      )}
      {variant !== "thumb" && (
        <span className="relative z-[2] mb-3 ml-3.5 rounded-md bg-black/30 px-2 py-1 font-mono text-[11px] font-bold uppercase tracking-[.1em] backdrop-blur-sm">
          {category}
        </span>
      )}
    </div>
  );
}
