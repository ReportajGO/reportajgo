import Image from "next/image";
import { getTranslations } from "next-intl/server";
import { getAdForSlot } from "@/lib/ads";
import { adSlotDef, AD_FORMAT_SIZE } from "@/lib/adSlots";

/**
 * Public advertising slot. Renders the active published creative for `slot`
 * (see lib/adSlots.ts), managed from the admin panel (/admin/ads). When no ad
 * qualifies — none published, or outside its schedule — the slot renders
 * nothing, so empty placements simply disappear from the page.
 */
export default async function AdSlot({
  slot,
  className = "",
}: {
  slot: string;
  className?: string;
}) {
  const ad = await getAdForSlot(slot);
  if (!ad) return null;

  const def = adSlotDef(slot);
  const size = def ? AD_FORMAT_SIZE[def.format] : AD_FORMAT_SIZE.banner;
  const t = await getTranslations("ads");

  const media = (
    <div className={`relative w-full overflow-hidden rounded-xl bg-bg-sub ${size}`}>
      <Image
        src={ad.imageUrl}
        alt={ad.title || t("label")}
        fill
        sizes="(max-width: 640px) 100vw, 728px"
        className="object-contain"
      />
    </div>
  );

  return (
    <aside aria-label={t("label")} className={`w-full ${className}`}>
      {ad.linkUrl ? (
        <a
          href={ad.linkUrl}
          target="_blank"
          rel="noopener noreferrer sponsored"
          className="block transition-opacity hover:opacity-95"
        >
          {media}
        </a>
      ) : (
        media
      )}
    </aside>
  );
}
