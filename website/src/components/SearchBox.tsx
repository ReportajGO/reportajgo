"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useRouter } from "@/i18n/navigation";

type Card = {
  id: string;
  title: string;
  categoryName: string;
  imageUrl: string | null;
};
type Suggestions = {
  query: string;
  terms: string[];
  themes: { slug: string; name: string }[];
  articles: Card[];
  trending: Card[];
  didYouMean: string | null;
};

// One keyboard-navigable row. `kind` drives the icon/section it renders under.
type Item =
  | { kind: "dym"; label: string; href: string }
  | { kind: "term"; label: string; href: string }
  | { kind: "theme"; label: string; href: string }
  | { kind: "article"; label: string; sub: string; img: string | null; href: string }
  | { kind: "all"; label: string; href: string };

const EMPTY: Suggestions = {
  query: "",
  terms: [],
  themes: [],
  articles: [],
  trending: [],
  didYouMean: null,
};

/** Split `text` around the first match of `q` so it can be highlighted. */
function Highlight({ text, q }: { text: string; q: string }) {
  const needle = q.trim();
  if (!needle) return <>{text}</>;
  const i = text.toLowerCase().indexOf(needle.toLowerCase());
  if (i === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark className="bg-transparent font-bold text-ink">
        {text.slice(i, i + needle.length)}
      </mark>
      {text.slice(i + needle.length)}
    </>
  );
}

export default function SearchBox({ className = "" }: { className?: string }) {
  const t = useTranslations("search");
  const tHeader = useTranslations("header");
  const locale = useLocale();
  const router = useRouter();
  const listId = useId();

  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Suggestions>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(-1);

  const rootRef = useRef<HTMLDivElement>(null);

  // Fetch suggestions (debounced), aborting any in-flight request.
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const id = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/search/suggest?q=${encodeURIComponent(q)}&locale=${locale}`,
          { signal: controller.signal },
        );
        if (res.ok) setData(await res.json());
      } catch {
        /* aborted or offline — keep previous suggestions */
      } finally {
        setLoading(false);
      }
    }, 160);
    return () => {
      clearTimeout(id);
      controller.abort();
    };
  }, [q, open, locale]);

  // Close on outside click.
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  // Build the flat, ordered list of keyboard-navigable items.
  const items: Item[] = [];
  const hasQuery = q.trim().length > 0;
  if (hasQuery) {
    if (data.didYouMean)
      items.push({
        kind: "dym",
        label: data.didYouMean,
        href: `/search?q=${encodeURIComponent(data.didYouMean)}`,
      });
    for (const term of data.terms)
      items.push({ kind: "term", label: term, href: `/search?q=${encodeURIComponent(term)}` });
    for (const th of data.themes)
      items.push({ kind: "theme", label: th.name, href: `/${th.slug}` });
    for (const a of data.articles)
      items.push({
        kind: "article",
        label: a.title,
        sub: a.categoryName,
        img: a.imageUrl,
        href: `/article/${a.id}`,
      });
    items.push({ kind: "all", label: q.trim(), href: `/search?q=${encodeURIComponent(q.trim())}` });
  } else {
    for (const a of data.trending)
      items.push({
        kind: "article",
        label: a.title,
        sub: a.categoryName,
        img: a.imageUrl,
        href: `/article/${a.id}`,
      });
    for (const th of data.themes)
      items.push({ kind: "theme", label: th.name, href: `/${th.slug}` });
  }

  function go(href: string) {
    setOpen(false);
    setActive(-1);
    router.push(href);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (items.length ? (i + 1) % items.length : -1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (items.length ? (i - 1 + items.length) % items.length : -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (active >= 0 && items[active]) go(items[active].href);
      else if (q.trim()) go(`/search?q=${encodeURIComponent(q.trim())}`);
    } else if (e.key === "Escape") {
      setOpen(false);
      setActive(-1);
    }
  }

  // Section headers map by the index where each section starts.
  let idx = -1;
  const themeStart = items.findIndex((it) => it.kind === "theme");
  const articleStart = items.findIndex((it) => it.kind === "article");
  const termStart = items.findIndex((it) => it.kind === "term" || it.kind === "dym");

  function header(i: number): string | null {
    if (!hasQuery && i === articleStart && data.trending.length) return t("trendingLabel");
    if (!hasQuery && i === themeStart) return t("sectionsLabel");
    if (hasQuery && i === termStart) return t("suggestionsLabel");
    if (hasQuery && i === themeStart && themeStart !== -1) return t("sectionsLabel");
    if (hasQuery && i === articleStart && articleStart !== -1) return t("articlesLabel");
    return null;
  }

  const showPanel = open && (items.length > 0 || loading);

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim()) go(`/search?q=${encodeURIComponent(q.trim())}`);
        }}
        className="flex items-center gap-2 rounded-full border border-line bg-bg-sub px-3.5 py-[7px] focus-within:border-brand-red"
        role="search"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 opacity-55">
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4.3-4.3" />
        </svg>
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(-1);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={tHeader("searchPlaceholder")}
          className="w-full bg-transparent font-display text-sm text-ink outline-none placeholder:text-ink-soft"
          role="combobox"
          aria-expanded={showPanel}
          aria-controls={listId}
          aria-autocomplete="list"
          autoComplete="off"
        />
        {loading && (
          <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-line border-t-brand-red" aria-hidden />
        )}
      </form>

      {showPanel && (
        <div
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 max-h-[70vh] overflow-y-auto rounded-2xl border border-line bg-bg p-1.5 shadow-xl"
        >
          {items.length === 0 && loading && (
            <div className="px-3 py-3 font-display text-sm text-ink-soft">…</div>
          )}

          {items.map((it) => {
            idx++;
            const i = idx;
            const isActive = i === active;
            const head = header(i);
            return (
              <div key={`${it.kind}-${i}`}>
                {head && (
                  <div className="px-3 pb-1 pt-2 font-display text-[11px] font-extrabold uppercase tracking-[.12em] text-ink-soft">
                    {head}
                  </div>
                )}
                <button
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go(it.href)}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors ${
                    isActive ? "bg-bg-sub" : "hover:bg-bg-sub"
                  }`}
                >
                  {it.kind === "article" ? (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {it.img ? (
                        <img src={it.img} alt="" className="h-10 w-14 shrink-0 rounded-md object-cover" />
                      ) : (
                        <span className="h-10 w-14 shrink-0 rounded-md bg-bg-sub" />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="line-clamp-1 font-serif text-[15px] font-semibold text-ink">
                          <Highlight text={it.label} q={q} />
                        </span>
                        <span className="line-clamp-1 font-display text-xs text-ink-soft">{it.sub}</span>
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-bg-sub text-ink-soft">
                        {it.kind === "theme" ? (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 6h16M4 12h16M4 18h10" /></svg>
                        ) : it.kind === "all" ? (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                        ) : (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
                        )}
                      </span>
                      <span className="min-w-0 flex-1 font-display text-sm text-ink">
                        {it.kind === "all" ? (
                          <span className="text-ink-soft">
                            {t("seeAllFor", { q: it.label })}
                          </span>
                        ) : it.kind === "dym" ? (
                          <span className="text-ink-soft">
                            {t("didYouMean", { term: it.label })}
                          </span>
                        ) : (
                          <Highlight text={it.label} q={q} />
                        )}
                      </span>
                    </>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
