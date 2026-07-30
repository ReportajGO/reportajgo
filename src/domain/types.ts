// Shared domain types used across pipeline stages.
// These mirror (but are decoupled from) the Prisma models so business logic
// doesn't depend directly on the ORM shapes.

export type Platform =
  | "TELEGRAM"
  | "INSTAGRAM"
  | "YOUTUBE"
  | "WEBSITE";

export type AspectRatio = "1:1" | "9:16" | "16:9" | "4:5";

export type MediaType = "IMAGE" | "VIDEO";

/**
 * Editorial priority level assigned to a news item by the ranking stage.
 *
 * NOTE ON "BREAKING": under the Global Media Network concept the network does
 * not publish breaking news (TZ §6 — urgency-driven and negative material is a
 * prohibited category). The level is retained because historical rows carry it
 * and the website still renders the badge, but the ranker no longer ASSIGNS it
 * and nothing may promote an item for being urgent. See `domain/editorial.ts`.
 */
export type NewsPriority = "BREAKING" | "HIGH" | "NORMAL" | "LOW";

// ─── Global network: markets, verticals, formats ──────────────────────────────

/** The 21 markets of the network (TZ §8). */
export type MarketCode =
  | "JP" | "KR" | "MY" | "CN" | "TW"
  | "TR" | "DE" | "FR" | "UK" | "SE" | "AT" | "RU" | "ES"
  | "AE" | "KW" | "QA" | "OM" | "SA"
  | "US" | "CA" | "BR";

/** Regional coordination groups (TZ §9). */
export type Region = "APAC" | "EUROPE" | "MENA" | "AMERICAS";

/** Rollout phase: 1 = pilot, 2 = expansion, 3 = full network (TZ §19). */
export type RolloutPhase = 1 | 2 | 3;

/** Publication intensity tier (TZ §13). */
export type CadenceTier = "PILOT" | "ACTIVE" | "WATCH";

/** The seven content verticals (TZ §5.1). */
export type Vertical =
  | "ECONOMY"
  | "INNOVATION"
  | "SCIENCE"
  | "STARTUP"
  | "PEOPLE"
  | "FACTS"
  | "HISTORY";

/** Production formats (TZ §7). */
export type ContentFormat =
  | "SHORT_VIDEO"
  | "EXPLAINER_VIDEO"
  | "TEXT_POST"
  | "CAROUSEL"
  | "MINI_REPORTAGE"
  | "INTERVIEW"
  | "ARTICLE"
  | "INFOGRAPHIC";

// ─── Compliance and approval ─────────────────────────────────────────────────

/** Prohibited content categories (TZ §6). */
export type BannedCategory =
  | "POLITICS"
  | "GEOPOLITICS"
  | "CONFLICT"
  | "CRIME"
  | "DISASTER"
  | "VIOLENCE"
  | "SCANDAL"
  | "MANIPULATION"
  | "DIVISIVE_HISTORY";

/**
 * Compliance outcome for a candidate:
 *  - GREEN:  publishable on the normal path.
 *  - YELLOW: publishable only with the handling rules in TZ §6.1 and a raised
 *            approval tier.
 *  - RED:    prohibited; dropped and never drafted.
 */
export type ComplianceZone = "GREEN" | "YELLOW" | "RED";

/** Approval ladder level (TZ §10.1). */
export type ApprovalTier = "A" | "B" | "C";

// ─── Uzbekistan quota ────────────────────────────────────────────────────────

export type QuotaVerdict = "ON_TARGET" | "UNDER" | "OVER" | "UNDETERMINED";

export interface QuotaAssessment {
  /** Uzbekistan-quota items published in the period. */
  uzCount: number;
  /** All items published in the period. */
  totalCount: number;
  /** Uzbekistan share, in percent, to one decimal. */
  share: number;
  /** Percentage points off target; positive = over-published. */
  drift: number;
  verdict: QuotaVerdict;
  target: number;
  tolerance: number;
}

// ─── Pipeline payloads ───────────────────────────────────────────────────────

/** A raw news candidate produced by the research stage (pre-persistence). */
export interface ResearchedNews {
  title: string;
  summary: string;
  sourceUrl: string;
  sourceName?: string;
  language: string;
  topic?: string;
  publishedAt?: Date;
  /** Vertical this candidate was researched for (TZ §5.1). */
  vertical?: Vertical;
  /** Target market this candidate was researched for (TZ §8). */
  market?: MarketCode;
  /** True when the item counts toward the 20% Uzbekistan quota (TZ §5.2). */
  uzbekistanQuota?: boolean;
  /**
   * The constructive angle: the solution, opportunity or useful takeaway that
   * makes this publishable under TZ §4. Research must supply one — an item with
   * no constructive angle is off-strategy by definition.
   */
  constructiveAngle?: string;
  /** Secondary corroborating source URLs (TZ §4 "faktlarga sodiqlik"). */
  additionalSources?: string[];
}

/** Compliance classification returned by the editorial ranking call. */
export interface ComplianceVerdict {
  zone: ComplianceZone;
  /** Prohibited categories the item falls into (empty unless zone is RED). */
  bannedCategories: BannedCategory[];
  /** Yellow-zone rule ids that apply. */
  yellowRules: string[];
  /** Minimum approval tier required before publication. */
  tier: ApprovalTier;
  /** Audit-trail explanation. */
  reason: string;
}

/** Ranking verdict from the filter stage. */
export interface RankVerdict {
  score: number; // 0..1 overall editorial value
  relevance: number; // 0..1 fit to the vertical + target market
  priority: NewsPriority; // editorial level derived in the same call
  reasons: string;
  /** 0..1 constructive value: solution, opportunity, progress, useful knowledge. */
  constructiveness: number;
  /** 0..1 confidence that the claims are verifiable from named sources. */
  verifiability: number;
  /** Compliance classification; a RED verdict drops the item. */
  compliance: ComplianceVerdict;
}

/**
 * The "content passport" carried by every published material (TZ §7.2).
 * Persisted on the draft so each post has a complete, auditable provenance
 * record: what it is, where it came from, who cleared it, and how it is tracked.
 */
export interface ContentPassport {
  /** Market, language and platform this version targets. */
  market: MarketCode | null;
  language: string;
  platform: Platform;
  /** Topic category and whether it counts toward the Uzbekistan quota. */
  vertical: Vertical | null;
  format: ContentFormat;
  uzbekistanQuota: boolean;
  /** Primary source plus any corroborating sources, with links. */
  primarySource: string;
  additionalSources: string[];
  /** Compliance zone, applicable yellow-zone handling, and approval tier. */
  complianceZone: ComplianceZone;
  yellowRules: string[];
  approvalTier: ApprovalTier;
  /** Whether any AI-generated media is attached and therefore must be labelled. */
  aiGeneratedMedia: boolean;
  /** Tracking link with UTM parameters (TZ §16). */
  utmUrl: string | null;
  /** Call to action rendered with the post. */
  cta: string | null;
}

/** Generated copy for one platform. */
export interface GeneratedCopy {
  platform: Platform;
  language: string;
  style: string;
  body: string;
  hashtags: string[];
}

/** A media generation request handed to a MediaProvider. */
export interface MediaRequest {
  type: MediaType;
  prompt: string;
  aspectRatio: AspectRatio;
  // Optional source image (URL or base64) for image-to-video.
  sourceImageUrl?: string;
}

/** Result of a media generation request. */
export interface MediaResult {
  provider: string;
  type: MediaType;
  aspectRatio: AspectRatio;
  url?: string;
  externalJobId?: string;
  status: "QUEUED" | "GENERATING" | "READY" | "FAILED";
  error?: string;
}
