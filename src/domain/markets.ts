// The 21-market distribution matrix — Reportage GO Global Media Network.
//
// Source of truth: "Reportage GO Xalqaro OAV Konsepsiya va TZ 2026", §8
// (til va platformalar matritsasi) and §19 (bosqichma-bosqich ishga tushirish).
//
// The core principle this file encodes: there is NO single global post. One
// master story becomes a per-market version — local language, local platforms,
// local cultural framing. "Barcha platformada bir xil post" is explicitly
// forbidden by the TZ, so every stage of the pipeline reads its target market
// from here rather than assuming one global audience.
//
// The TZ requires this matrix to be re-reviewed EVERY QUARTER (§8, §25) because
// platform reach and local rules shift fast. Treat edits here as an editorial
// decision, not a code change.

import type { MarketCode, Region, RolloutPhase, CadenceTier } from "./types.js";

export interface Market {
  code: MarketCode;
  /** Market name as used in the concept document (Uzbek). */
  name: string;
  /** English name, for logs and dashboards. */
  nameEn: string;
  region: Region;
  /**
   * Primary publication language (BCP-47-ish code used across the pipeline).
   * This is the language the market's audience actually reads — never a
   * mechanical translation target.
   */
  primaryLanguage: string;
  /**
   * Secondary language used for selected B2B/investor material only (TZ §11).
   * e.g. Gulf markets publish Arabic for the general audience and English on
   * LinkedIn for investors.
   */
  secondaryLanguage?: string;
  /**
   * Priority platforms, most important first. Per TZ §8 each market must cover
   * at least one video platform, one social/community platform, and one
   * professional or text channel.
   */
  platforms: string[];
  /** Localization guidance fed verbatim into the copy prompt (TZ §8 "izoh"). */
  localizationNote: string;
  /** Rollout phase this market belongs to (TZ §19). */
  phase: RolloutPhase;
  /** Publication intensity tier (TZ §13). */
  cadence: CadenceTier;
}

/**
 * All 21 markets, in the numbering used by the concept document.
 *
 * Note on the source list: the document flags (§1, "MUHIM ANIQLIK") that its
 * printed numbering repeats "19", while the real coverage is 21 markets. This
 * matrix is the corrected, de-duplicated 21.
 */
export const MARKETS: readonly Market[] = [
  {
    code: "JP",
    name: "Yaponiya",
    nameEn: "Japan",
    region: "APAC",
    primaryLanguage: "ja",
    platforms: ["LINE", "YOUTUBE", "X", "INSTAGRAM", "TIKTOK"],
    localizationNote:
      "Short headlines, minimal visuals. Facts and credibility outrank emotion. " +
      "No hype adjectives; cite the source explicitly.",
    phase: 1,
    cadence: "PILOT",
  },
  {
    code: "KR",
    name: "Janubiy Koreya",
    nameEn: "South Korea",
    region: "APAC",
    primaryLanguage: "ko",
    platforms: ["KAKAOTALK", "YOUTUBE", "INSTAGRAM", "NAVER", "TIKTOK"],
    localizationNote:
      "Fit the Naver search ecosystem and mobile video format. Searchable " +
      "keyword-led titles; assume a phone screen first.",
    phase: 1,
    cadence: "PILOT",
  },
  {
    code: "MY",
    name: "Malayziya",
    nameEn: "Malaysia",
    region: "APAC",
    primaryLanguage: "ms",
    secondaryLanguage: "en",
    platforms: ["FACEBOOK", "TIKTOK", "YOUTUBE", "INSTAGRAM", "LINKEDIN"],
    localizationNote:
      "Multilingual audience: the main post is Malay, B2B material runs in " +
      "English. Keep both versions independently edited.",
    phase: 1,
    cadence: "PILOT",
  },
  {
    code: "CN",
    name: "Xitoy",
    nameEn: "China",
    region: "APAC",
    primaryLanguage: "zh-Hans",
    platforms: ["WECHAT", "DOUYIN", "WEIBO", "BILIBILI", "XIAOHONGSHU"],
    localizationNote:
      "SIMPLIFIED Chinese only — never traditional. Requires a local operator, " +
      "platform verification and compliance clearance before publishing.",
    phase: 1,
    cadence: "PILOT",
  },
  {
    code: "TW",
    name: "Tayvan",
    nameEn: "Taiwan",
    region: "APAC",
    primaryLanguage: "zh-Hant",
    platforms: ["FACEBOOK", "YOUTUBE", "INSTAGRAM", "LINE", "X"],
    localizationNote:
      "TRADITIONAL Chinese characters only — never reuse the simplified China " +
      "version. Separate editorial pass, separate glossary.",
    phase: 3,
    cadence: "WATCH",
  },
  {
    code: "TR",
    name: "Turkiya",
    nameEn: "Türkiye",
    region: "EUROPE",
    primaryLanguage: "tr",
    platforms: ["INSTAGRAM", "YOUTUBE", "TIKTOK", "X", "LINKEDIN"],
    localizationNote:
      "Emotional but strictly fact-based headlines. LinkedIn carries the B2B " +
      "and investment angle.",
    phase: 1,
    cadence: "PILOT",
  },
  {
    code: "DE",
    name: "Germaniya",
    nameEn: "Germany",
    region: "EUROPE",
    primaryLanguage: "de",
    platforms: ["YOUTUBE", "INSTAGRAM", "TIKTOK", "LINKEDIN", "FACEBOOK"],
    localizationNote:
      "Precision, numbers, named sources and practical value. German readers " +
      "reject unsupported claims — quantify everything.",
    phase: 2,
    cadence: "ACTIVE",
  },
  {
    code: "FR",
    name: "Fransiya",
    nameEn: "France",
    region: "EUROPE",
    primaryLanguage: "fr",
    platforms: ["YOUTUBE", "INSTAGRAM", "TIKTOK", "LINKEDIN", "FACEBOOK"],
    localizationNote:
      "Local style and terminology; avoid an advertising tone entirely. " +
      "Editorial register, not promotional.",
    phase: 2,
    cadence: "ACTIVE",
  },
  {
    code: "UK",
    name: "Buyuk Britaniya",
    nameEn: "United Kingdom",
    region: "EUROPE",
    primaryLanguage: "en",
    platforms: ["YOUTUBE", "INSTAGRAM", "TIKTOK", "LINKEDIN", "X"],
    localizationNote:
      "Data-led storytelling. LinkedIn and X carry business and innovation; " +
      "lead with the figure, then the human consequence.",
    phase: 2,
    cadence: "ACTIVE",
  },
  {
    code: "SE",
    name: "Shvetsiya",
    nameEn: "Sweden",
    region: "EUROPE",
    primaryLanguage: "sv",
    platforms: ["YOUTUBE", "INSTAGRAM", "TIKTOK", "LINKEDIN", "FACEBOOK"],
    localizationNote:
      "Sustainability, innovation and human-capital angles perform strongest. " +
      "Understated tone; no superlatives.",
    phase: 3,
    cadence: "WATCH",
  },
  {
    code: "AT",
    name: "Avstriya",
    nameEn: "Austria",
    region: "EUROPE",
    primaryLanguage: "de",
    platforms: ["YOUTUBE", "INSTAGRAM", "TIKTOK", "LINKEDIN", "FACEBOOK"],
    localizationNote:
      "Do NOT copy the Germany version — re-frame for the Austrian context " +
      "(local institutions, local examples) even though the language matches.",
    phase: 3,
    cadence: "WATCH",
  },
  {
    code: "RU",
    name: "Rossiya",
    nameEn: "Russia",
    region: "EUROPE",
    primaryLanguage: "ru",
    platforms: ["VK", "TELEGRAM", "YANDEX_ZEN", "RUTUBE"],
    localizationNote:
      "Platform access and local media rules are monitored continuously. " +
      "Strictly non-political framing.",
    phase: 2,
    cadence: "ACTIVE",
  },
  {
    code: "AE",
    name: "Birlashgan Arab Amirliklari",
    nameEn: "United Arab Emirates",
    region: "MENA",
    primaryLanguage: "ar",
    secondaryLanguage: "en",
    platforms: ["INSTAGRAM", "TIKTOK", "YOUTUBE", "LINKEDIN", "X"],
    localizationNote:
      "Bilingual distribution for investor and expat audiences. RTL layout " +
      "and Arabic typography for the Arabic version.",
    phase: 1,
    cadence: "PILOT",
  },
  {
    code: "KW",
    name: "Quvayt",
    nameEn: "Kuwait",
    region: "MENA",
    primaryLanguage: "ar",
    secondaryLanguage: "en",
    platforms: ["INSTAGRAM", "SNAPCHAT", "TIKTOK", "YOUTUBE", "X"],
    localizationNote:
      "Mobile-first, short video, visual simplicity. RTL layout for Arabic.",
    phase: 3,
    cadence: "WATCH",
  },
  {
    code: "QA",
    name: "Qatar",
    nameEn: "Qatar",
    region: "MENA",
    primaryLanguage: "ar",
    secondaryLanguage: "en",
    platforms: ["INSTAGRAM", "SNAPCHAT", "TIKTOK", "YOUTUBE", "LINKEDIN"],
    localizationNote:
      "B2B, innovation, sports economy and international cooperation. RTL " +
      "layout for Arabic.",
    phase: 3,
    cadence: "WATCH",
  },
  {
    code: "OM",
    name: "Ummon",
    nameEn: "Oman",
    region: "MENA",
    primaryLanguage: "ar",
    secondaryLanguage: "en",
    platforms: ["INSTAGRAM", "TIKTOK", "YOUTUBE", "SNAPCHAT", "X"],
    localizationNote:
      "Cultural respect first. Tourism, logistics and green-economy themes. " +
      "RTL layout for Arabic.",
    phase: 3,
    cadence: "WATCH",
  },
  {
    code: "SA",
    name: "Saudiya Arabistoni",
    nameEn: "Saudi Arabia",
    region: "MENA",
    primaryLanguage: "ar",
    secondaryLanguage: "en",
    platforms: ["SNAPCHAT", "TIKTOK", "YOUTUBE", "INSTAGRAM", "X", "LINKEDIN"],
    localizationNote:
      "Short video for the young audience, LinkedIn for investors. RTL layout " +
      "and Arabic typography.",
    phase: 2,
    cadence: "ACTIVE",
  },
  {
    code: "US",
    name: "AQSh",
    nameEn: "United States",
    region: "AMERICAS",
    primaryLanguage: "en",
    secondaryLanguage: "es",
    platforms: ["YOUTUBE", "INSTAGRAM", "TIKTOK", "LINKEDIN", "X", "FACEBOOK"],
    localizationNote:
      "Segment explicitly: B2B, startup, diaspora, and a Spanish-language " +
      "audience for selected series.",
    phase: 2,
    cadence: "ACTIVE",
  },
  {
    code: "ES",
    name: "Ispaniya",
    nameEn: "Spain",
    region: "EUROPE",
    primaryLanguage: "es",
    platforms: ["YOUTUBE", "INSTAGRAM", "TIKTOK", "LINKEDIN", "FACEBOOK", "X"],
    localizationNote:
      "Castilian Spanish is the base. Regional languages only for dedicated " +
      "projects, never by default.",
    phase: 3,
    cadence: "WATCH",
  },
  {
    code: "CA",
    name: "Kanada",
    nameEn: "Canada",
    region: "AMERICAS",
    primaryLanguage: "en",
    secondaryLanguage: "fr",
    platforms: ["YOUTUBE", "INSTAGRAM", "TIKTOK", "LINKEDIN", "FACEBOOK"],
    localizationNote:
      "Two official languages. The French version is edited independently for " +
      "Québec — never mechanically copied from English.",
    phase: 3,
    cadence: "WATCH",
  },
  {
    code: "BR",
    name: "Braziliya",
    nameEn: "Brazil",
    region: "AMERICAS",
    primaryLanguage: "pt-BR",
    platforms: ["INSTAGRAM", "YOUTUBE", "TIKTOK", "WHATSAPP", "LINKEDIN", "FACEBOOK"],
    localizationNote:
      "Brazilian Portuguese (not European). High-energy video and community " +
      "distribution via WhatsApp Channels.",
    phase: 2,
    cadence: "ACTIVE",
  },
] as const;

const BY_CODE = new Map<string, Market>(MARKETS.map((m) => [m.code, m]));

/** Look up a market by code. Returns undefined for an unknown code. */
export function findMarket(code: string): Market | undefined {
  return BY_CODE.get(code.toUpperCase());
}

/** Look up a market by code, throwing when it does not exist. */
export function marketOf(code: string): Market {
  const market = findMarket(code);
  if (!market) throw new Error(`unknown market: ${code}`);
  return market;
}

/** True when `code` names one of the 21 configured markets. */
export function isMarketCode(code: unknown): code is MarketCode {
  return typeof code === "string" && BY_CODE.has(code.toUpperCase());
}

/** Every market code, in document order. */
export function allMarketCodes(): MarketCode[] {
  return MARKETS.map((m) => m.code);
}

/**
 * Markets whose rollout phase has been reached. Phase 1 = the six pilot
 * markets, phase 2 adds expansion, phase 3 completes all 21 (TZ §19).
 */
export function marketsUpToPhase(phase: RolloutPhase): Market[] {
  return MARKETS.filter((m) => m.phase <= phase);
}

/** Markets in a region, for the regional coordinator view (TZ §9). */
export function marketsInRegion(region: Region): Market[] {
  return MARKETS.filter((m) => m.region === region);
}

/**
 * Every language the network publishes in, deduped. Includes secondary (B2B)
 * languages, since those need their own native editor and glossary.
 */
export function allPublicationLanguages(): string[] {
  const langs = new Set<string>();
  for (const m of MARKETS) {
    langs.add(m.primaryLanguage);
    if (m.secondaryLanguage) langs.add(m.secondaryLanguage);
  }
  return [...langs];
}

/**
 * Whether this market's Arabic/Hebrew-style right-to-left layout applies to the
 * given language. Drives card rendering and subtitle alignment (TZ §11, §12).
 */
export function isRtlLanguage(language: string): boolean {
  return /^(ar|he|fa|ur)\b/i.test(language);
}
