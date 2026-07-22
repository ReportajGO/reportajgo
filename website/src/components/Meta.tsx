import { useTranslations } from "next-intl";
import { relativeTime } from "@/lib/time";

/** Category pill · timestamp · optional read-time, for cards & readers. */
export default function Meta({
  categoryName,
  createdAt,
  readMin,
}: {
  categoryName: string;
  createdAt: string;
  readMin?: number;
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
    </div>
  );
}
