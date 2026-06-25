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

/**
 * Fetch live rates from open.er-api.com, falling back to mock data.
 * Cached for 24h via Next's fetch cache — the source itself updates once a
 * day, so the ticker refreshes daily.
 */
export async function getRates(): Promise<Rate[]> {
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
