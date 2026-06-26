import { getTranslations } from "next-intl/server";
import { getRates } from "@/lib/rates";

export default async function Ticker() {
  const [rates, t] = await Promise.all([getRates(), getTranslations("ticker")]);

  const items = rates.map((r) => (
    <span key={r.code} className="inline-flex items-baseline gap-[7px]">
      <b className="font-bold">{r.code}</b>
      <span>{r.uzs.toLocaleString("en-US")}</span>
      <span className="opacity-60">{t("unit")}</span>
      <span className={r.up ? "text-[#2fd07a]" : "text-[#ff6b5b]"}>
        {r.up ? "▲" : "▼"}
      </span>
    </span>
  ));

  // Background stays constant (dark) in both themes; only the font color
  // adapts: pure white in light theme, soft white (ink) in dark theme.
  return (
    <div className="overflow-hidden border-b border-white/10 bg-brand-black text-white dark:text-ink">
      <div className="flex items-center">
        <div className="z-[2] flex shrink-0 items-center gap-2 bg-brand-red px-3.5 py-[7px] font-display text-xs font-extrabold uppercase tracking-[.08em] text-white">
          <span className="h-2 w-2 animate-pulse rounded-full bg-white" />
          {t("label")}
        </div>
        <div className="ticker-mask flex-1 overflow-hidden">
          <div className="flex w-max animate-ticker gap-[34px] px-[22px] py-[7px] font-mono text-[13px]">
            {items}
            {/* duplicate run for a seamless loop */}
            {items}
          </div>
        </div>
      </div>
    </div>
  );
}
