import { useTranslations } from "next-intl";
import { relativeTime } from "@/lib/time";

/** Compact "1.2k" style number formatting for view counts. */
function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/** Category pill · timestamp · optional read-time / views, for cards & readers. */
export default function Meta({
  categoryName,
  createdAt,
  readMin,
  views,
}: {
  categoryName: string;
  createdAt: string;
  readMin?: number;
  views?: number;
}) {
  const tTime = useTranslations("time");
  const tArticle = useTranslations("article");

  const rel = relativeTime(createdAt);
  const when =
    rel.unit === "just" ? tTime("just") : `${rel.value} ${tTime(rel.unit)}`;

  return (
    <div className="flex items-center gap-2 font-mono text-[11px] text-ink-soft">
      <span className="font-display text-[11px] font-extrabold uppercase tracking-[.07em] text-brand-red">
        {categoryName}
      </span>
      <span className="h-[3px] w-[3px] rounded-full bg-ink-soft" />
      <span>{when}</span>
      {readMin ? (
        <>
          <span className="h-[3px] w-[3px] rounded-full bg-ink-soft" />
          <span>
            {readMin} {tArticle("readMin")}
          </span>
        </>
      ) : null}
      {views !== undefined ? (
        <>
          <span className="h-[3px] w-[3px] rounded-full bg-ink-soft" />
          <span className="inline-flex items-center gap-1">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12Z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            {formatCount(views)} {tArticle("views")}
          </span>
        </>
      ) : null}
    </div>
  );
}
