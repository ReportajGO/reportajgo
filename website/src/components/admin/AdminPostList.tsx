"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import DeleteButton from "@/components/admin/DeleteButton";

export interface AdminPostRow {
  id: string;
  title: string;
  imageUrl: string | null;
  categoryName: string;
  language: string;
  cleared: boolean;
  breaking: boolean;
  when: string;
}

type StatusFilter = "all" | "live" | "cleared";

// Diacritic-insensitive lowercase for tolerant title search.
function fold(s: string): string {
  return s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export default function AdminPostList({ rows }: { rows: AdminPostRow[] }) {
  const t = useTranslations("admin");
  const [q, setQ] = useState("");
  const [section, setSection] = useState("");
  const [lang, setLang] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");

  // Options derived from the data itself, so they always match what exists.
  const sections = useMemo(
    () => [...new Set(rows.map((r) => r.categoryName).filter(Boolean))].sort(),
    [rows],
  );
  const langs = useMemo(
    () => [...new Set(rows.map((r) => r.language).filter(Boolean))].sort(),
    [rows],
  );

  const filtered = useMemo(() => {
    const needle = fold(q.trim());
    return rows.filter((r) => {
      if (section && r.categoryName !== section) return false;
      if (lang && r.language !== lang) return false;
      if (status === "live" && r.cleared) return false;
      if (status === "cleared" && !r.cleared) return false;
      if (needle && !fold(r.title).includes(needle)) return false;
      return true;
    });
  }, [rows, q, section, lang, status]);

  const isFiltering = Boolean(q || section || lang || status !== "all");
  const reset = () => {
    setQ("");
    setSection("");
    setLang("");
    setStatus("all");
  };

  const selectCls =
    "rounded-lg border border-line bg-surface px-3 py-2 font-display text-sm text-ink outline-none focus:border-brand-red";

  return (
    <div>
      {/* Filter bar */}
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("filter.search")}
          className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-2 font-display text-sm text-ink outline-none focus:border-brand-red sm:min-w-[200px]"
        />
        <select value={section} onChange={(e) => setSection(e.target.value)} className={selectCls}>
          <option value="">{t("filter.allSections")}</option>
          {sections.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select value={lang} onChange={(e) => setLang(e.target.value)} className={selectCls}>
          <option value="">{t("filter.allLangs")}</option>
          {langs.map((l) => (
            <option key={l} value={l}>
              {l.toUpperCase()}
            </option>
          ))}
        </select>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as StatusFilter)}
          className={selectCls}
        >
          <option value="all">{t("filter.allStatus")}</option>
          <option value="live">{t("filter.live")}</option>
          <option value="cleared">{t("filter.cleared")}</option>
        </select>
        {isFiltering && (
          <button
            type="button"
            onClick={reset}
            className="rounded-lg border border-line px-3 py-2 font-display text-sm font-bold text-ink-soft transition-colors hover:border-brand-red hover:text-ink"
          >
            {t("filter.reset")}
          </button>
        )}
        <span className="font-display text-xs text-ink-soft sm:ml-auto">
          {t("filter.results", { n: filtered.length, total: rows.length })}
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-line bg-surface py-16 text-center font-display text-ink-soft">
          {t("filter.noMatches")}
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {filtered.map((p) => (
            <li key={p.id} className="flex gap-3 rounded-xl border border-line bg-surface p-3">
              {/* Small thumbnail */}
              <div className="relative h-16 w-24 shrink-0 overflow-hidden rounded-lg bg-bg-sub">
                {p.imageUrl ? (
                  <Image
                    src={p.imageUrl}
                    alt=""
                    fill
                    sizes="96px"
                    className={`object-cover ${p.cleared ? "opacity-50 grayscale" : ""}`}
                  />
                ) : (
                  <div className="grid h-full w-full place-items-center text-ink-soft/50">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="18" height="18" rx="2" />
                      <circle cx="9" cy="9" r="2" />
                      <path d="m21 15-3.5-3.5L9 20" />
                    </svg>
                  </div>
                )}
                {p.breaking && (
                  <span className="absolute left-1 top-1 rounded bg-brand-red px-1 py-0.5 text-[9px] font-bold leading-none text-white">
                    BR
                  </span>
                )}
              </div>

              {/* Content */}
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex items-start gap-1.5">
                  {p.cleared && (
                    <span className="mt-0.5 shrink-0 rounded bg-ink-soft/20 px-1.5 py-0.5 text-[10px] font-bold uppercase text-ink-soft">
                      {t("clear.badge")}
                    </span>
                  )}
                  <span className={`line-clamp-2 font-display text-sm font-semibold leading-snug ${p.cleared ? "text-ink-soft line-through" : "text-ink"}`}>
                    {p.title}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 font-display text-xs text-ink-soft">
                  <span>{p.categoryName}</span>
                  <span aria-hidden>·</span>
                  <span className="uppercase">{p.language}</span>
                  <span aria-hidden>·</span>
                  <span>{p.when}</span>
                </div>
                <div className="mt-auto flex items-center gap-4 pt-2">
                  <Link
                    href={`/admin/${p.id}/edit`}
                    className="font-display text-xs font-bold text-brand-red hover:underline"
                  >
                    {t("actions.edit")}
                  </Link>
                  <DeleteButton id={p.id} />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
