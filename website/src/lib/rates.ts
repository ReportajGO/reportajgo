// Currency rate service for the ticker.
// Mock-first with a live fetch fallback, isolated here per the brief.

export type Rate = {
  code: string;
  symbol: string;
  /** value of 1 unit of this currency in UZS */
  uzs: number;
  /** purely cosmetic trend arrow direction */
  up: boolean;
};

// Currencies shown in the ticker (UZS is the base, not listed).
const CURRENCIES: { code: string; symbol: string }[] = [
  { code: "USD", symbol: "$" },
  { code: "EUR", symbol: "€" },
  { code: "RUB", symbol: "₽" },
  { code: "CNY", symbol: "¥" },
  { code: "GBP", symbol: "£" },
  { code: "KZT", symbol: "₸" },
  { code: "TRY", symbol: "₺" },
];

// Fallback "X per 1 USD" rates, used when the API is unreachable.
const FALLBACK: Record<string, number> = {
  UZS: 12650,
  EUR: 0.92,
  RUB: 88,
  CNY: 7.25,
  GBP: 0.79,
  KZT: 480,
  TRY: 34,
  USD: 1,
};

function build(perUsd: Record<string, number>): Rate[] {
  const uzsPerUsd = perUsd.UZS || FALLBACK.UZS;
  return CURRENCIES.map((c, i) => {
    const uzs =
      c.code === "USD"
        ? uzsPerUsd
        : uzsPerUsd / (perUsd[c.code] || FALLBACK[c.code]);
    return {
      code: c.code,
      symbol: c.symbol,
      uzs: Math.round(uzs),
      // deterministic pseudo-trend (no Math.random in server render)
      up: (Math.round(uzs) + i) % 2 === 0,
    };
  });
}

// ── Central Bank of Uzbekistan (official daily rates) ───────────────────────
// https://cbu.uz/uz/arkhiv-kursov-valyut/json/ — UZS per `Nominal` units of each
// currency, updated once per business day. `Diff` is the day-over-day change.
interface CbuRate {
  Ccy: string;
  Rate: string;
  Diff: string;
  Nominal: string;
}

async function fromCbu(): Promise<Rate[] | null> {
  try {
    const res = await fetch("https://cbu.uz/uz/arkhiv-kursov-valyut/json/", {
      next: { revalidate: 3600 }, // re-check hourly; CBU itself changes daily
    });
    if (!res.ok) return null;
    const data = (await res.json()) as CbuRate[];
    if (!Array.isArray(data) || data.length === 0) return null;

    const byCcy = new Map(data.map((r) => [r.Ccy, r]));
    const out: Rate[] = [];
    for (const c of CURRENCIES) {
      const r = byCcy.get(c.code);
      if (!r) continue;
      const nominal = Number(r.Nominal) || 1;
      const uzs = Number(r.Rate) / nominal;
      if (!Number.isFinite(uzs) || uzs <= 0) continue;
      // Real daily trend from CBU's Diff (UZS change vs. previous day).
      out.push({ code: c.code, symbol: c.symbol, uzs: Math.round(uzs), up: Number(r.Diff) >= 0 });
    }
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

/**
 * Currency rates for the ticker. Primary source is the Central Bank of
 * Uzbekistan (official, updated daily); falls back to open.er-api and then to
 * static mock data if CBU is unreachable.
 */
export async function getRates(): Promise<Rate[]> {
  const cbu = await fromCbu();
  if (cbu) return cbu;

  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD", {
      next: { revalidate: 86400 },
    });
    const data = await res.json();
    if (data?.rates?.UZS) return build(data.rates);
  } catch {
    // ignore — fall through to mock
  }
  return build(FALLBACK);
}
