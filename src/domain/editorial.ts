// The editorial charter: principles, hard prohibitions, the "yellow zone", and
// the three-level approval ladder.
//
// Source of truth: TZ §4 (tahririyat pozitsiyasi va asosiy tamoyillar),
// §6 (taqiqlangan va cheklangan kontent), §6.1 (sariq zona),
// §10.1 (tasdiqlash darajalari).
//
// ─────────────────────────────────────────────────────────────────────────────
// This file encodes the single biggest strategy reversal in the network.
//
// The agent previously optimised FOR breaking news: it searched for "breaking
// international news", ranked BREAKING highest, and let a high-urgency story
// jump the publish queue. Under the new concept that behaviour is a compliance
// violation, not a feature. Reportage GO is explicitly a CONSTRUCTIVE outlet:
// solution-centred, non-political, non-sensational. Crime, disaster, conflict,
// politics and panic are prohibited categories — the exact material a
// breaking-news bias surfaces first.
//
// So: BANNED_CATEGORIES is a hard gate that runs BEFORE any editorial scoring,
// and nothing in the pipeline may promote an item for being urgent.
// ─────────────────────────────────────────────────────────────────────────────

import type { ApprovalTier, BannedCategory, ComplianceZone } from "./types.js";

/** The six standing editorial principles (TZ §4), fed into generation prompts. */
export const EDITORIAL_PRINCIPLES: readonly { id: string; rule: string }[] = [
  {
    id: "factual",
    rule:
      "Faithfulness to facts: every claim rests on at least one reliable primary " +
      "source, or two independent secondary sources.",
  },
  {
    id: "localized",
    rule:
      "Localisation: never a word-for-word translation. Use the style, headline " +
      "conventions, examples and format the local audience actually reads.",
  },
  {
    id: "constructive",
    rule:
      "Constructive agenda: content is centred on solutions, opportunities, " +
      "progress and useful knowledge — NOT on problems.",
  },
  {
    id: "apolitical",
    rule:
      "Political neutrality: elections, political contests, geopolitical " +
      "confrontation, promotion of political figures and political evaluation are " +
      "not covered at all.",
  },
  {
    id: "respectful",
    rule:
      "Cultural respect: no stereotypes, discrimination, or wording that offends " +
      "religious, national, historical or gender sensibilities.",
  },
  {
    id: "transparent",
    rule:
      "Transparency: sponsorship, advertising and partnership material is clearly " +
      "separated from editorial content and labelled as such.",
  },
];

/**
 * Absolutely prohibited content categories (TZ §6). An item matching ANY of
 * these is dropped — there is no score high enough to rescue it.
 */
export interface BannedCategorySpec {
  id: BannedCategory;
  /** What the category covers, used in the compliance prompt. */
  description: string;
  /**
   * Cheap deterministic signals checked before any LLM call.
   *
   * PRECISION IS MANDATORY HERE. A match is TERMINAL: `rankNews` drops the item
   * without ever calling the LLM, so there is no semantic backstop to rescue a
   * false positive. That makes every entry a potential silent hole in the feed.
   *
   * The rule for adding a keyword: it must be implausible in benign copy about
   * business, science, startups or people — the registers that make up most of
   * the network's output. Generic single words fail that test, because English
   * business writing is full of martial and catastrophic idiom:
   *     "price war", "talent war", "bidding war"     → not CONFLICT
   *     "shooting for the stars", "shooting a video" → not CRIME
   *     "blasts past its target", "slams the door"   → not SCANDAL
   *     "demand explosion", "spread like wildfire"   → not DISASTER
   *     "vaccine candidate", "candidate for the job" → not POLITICS
   *     "killed its burn rate"                       → not CRIME
   * All of those were real false positives during development. Prefer a
   * multi-word phrase and let the LLM classifier catch what the phrase misses;
   * a missed item is re-caught semantically, whereas a false positive is
   * unrecoverable.
   */
  keywords: readonly string[];
}

export const BANNED_CATEGORIES: readonly BannedCategorySpec[] = [
  {
    id: "POLITICS",
    description:
      "Political news, elections, political parties, promotion of political " +
      "figures, political evaluation or commentary of any kind.",
    // "candidate" removed: "vaccine candidate", "candidate for the role".
    keywords: [
      "election", "elections", "ballot box", "referendum", "campaign trail",
      "parliament vote", "impeachment", "coalition talks", "political party",
      "prime minister race", "presidential race", "saylov", "ovoz berish",
      "выборы", "избирател",
    ],
  },
  {
    id: "GEOPOLITICS",
    description:
      "Geopolitical disputes, inter-state confrontation, sanctions politics, " +
      "alliance rivalry.",
    keywords: [
      "geopolitical", "sanctions against", "territorial dispute", "annexation",
      "diplomatic row", "trade war", "espionage", "sanksiya", "геополит", "санкции",
    ],
  },
  {
    id: "CONFLICT",
    description: "Armed conflict, war, military operations, terrorism.",
    // Bare "war" removed: price war, talent war, bidding war, war for talent.
    // Bare "missile"/"troops"/"invasion" removed: rocketry and space coverage is
    // legitimate INNOVATION material, and "invasion of privacy" is not conflict.
    keywords: [
      "civil war", "at war with", "war crimes", "warzone", "war zone",
      "airstrike", "air strike", "missile strike", "ballistic missile",
      "shelling", "troop deployment", "ceasefire", "insurgent", "terrorist",
      "terrorism", "militant", "military invasion", "armed conflict",
      "urush", "harbiy", "война", "военн", "теракт",
    ],
  },
  {
    id: "CRIME",
    description: "Crime, arrests, investigations, court cases, corruption cases.",
    // Bare "killed" removed: "killed its burn rate", "killed the project".
    // Bare "shooting" removed: "shooting a video", "shooting for the stars".
    // Bare "assault"/"trafficking" narrowed to their criminal senses.
    keywords: [
      "murder", "homicide", "arrested", "arrest warrant", "indicted",
      "convicted", "fraud charges", "money laundering", "human trafficking",
      "drug trafficking", "kidnap", "rape", "assault charges", "mass shooting",
      "shooting attack", "stabbing", "embezzlement",
      "jinoyat", "qotillik", "hibsga", "убийств", "задержан", "мошенничеств",
    ],
  },
  {
    id: "DISASTER",
    description:
      "Accidents, disasters, catastrophes, casualties, emergencies and any " +
      "content that spreads fear or panic.",
    // Bare "explosion" removed: "demand explosion", "explosion in growth".
    // Bare "wildfire" removed: "spread like wildfire".
    // Bare "epidemic"/"evacuated" removed: "epidemic of loneliness" and benign
    // building evacuations. Casualty phrasing carries this category instead.
    keywords: [
      "earthquake", "wildfires burn", "flooding kills", "plane crash",
      "crash kills", "death toll", "casualties", "fatalities",
      "deadly explosion", "outbreak kills", "famine", "mass evacuation",
      "natural disaster", "state of emergency",
      "falokat", "halokat", "qurbon", "катастроф", "погибл", "жертв",
    ],
  },
  {
    id: "VIOLENCE",
    description: "Violence, abuse, personal tragedy, graphic or distressing material.",
    // Bare "brutal" removed: "brutal competition", "brutally honest".
    keywords: [
      "violence", "torture", "abuse victim", "suicide", "self-harm",
      "massacre", "domestic abuse", "zo'ravonlik", "насили",
    ],
  },
  {
    id: "SCANDAL",
    description:
      "Scandal, accusation, criticism pieces, conflict-driven or sensational " +
      "content, personal disputes.",
    // Bare "slams"/"blasts" removed: "blasts past its target", "slams the door".
    // Bare "outrage"/"backlash" kept — both are inherently conflict-framing.
    keywords: [
      "scandal", "accuses", "accusation", "lawsuit against", "sues over",
      "backlash", "outrage", "public feud", "controversy",
      "skandal", "скандал",
    ],
  },
  {
    id: "MANIPULATION",
    description:
      "Unverified praise, fabricated figures, misleading headlines, artificial " +
      "dramatisation, quotes stripped of context, or hidden advertising.",
    keywords: [
      "world's only", "world first ever", "unprecedented miracle", "shocking truth",
      "you won't believe", "miracle cure", "guaranteed returns",
    ],
  },
  {
    id: "DIVISIVE_HISTORY",
    description:
      "Historical interpretation capable of provoking dispute between nations, " +
      "religions or states.",
    keywords: [
      "genocide", "ethnic cleansing", "colonial crimes", "disputed territory history",
      "historical injustice",
    ],
  },
];

/**
 * "Yellow zone" topics (TZ §6.1) — publishable, but only with the extra
 * approval and framing constraints described here. These do NOT drop an item;
 * they raise its approval tier and attach a handling instruction.
 */
export interface YellowZoneSpec {
  id: string;
  description: string;
  /** How the material must be handled to be publishable. */
  handling: string;
  /** Set when the rule blocks publication outright rather than escalating. */
  blocking?: boolean;
  keywords: readonly string[];
}

export const YELLOW_ZONE: readonly YellowZoneSpec[] = [
  {
    id: "state-decision",
    description: "Government decisions, decrees, state programmes.",
    handling:
      "Cover ONLY through the economic or investment impact. No political " +
      "evaluation, no attribution of credit to political figures.",
    keywords: [
      "decree", "government approved", "state programme", "state program",
      "ministry announced", "qaror", "farmon", "постановлен", "указ",
    ],
  },
  {
    id: "medical",
    description: "Medicine and health science.",
    handling:
      "Never present as treatment advice. State the source and the limits of the " +
      "finding explicitly.",
    keywords: [
      "clinical trial", "treatment", "therapy", "vaccine", "drug approval",
      "diagnosis", "patients", "tibbiyot", "лечени", "вакцин",
    ],
  },
  {
    id: "commercial-interest",
    description: "Material about a company where a financial or partner interest exists.",
    handling:
      "Label as 'hamkorlik materiali' (partnership material). The sponsor may not " +
      "influence the factual content or conclusion.",
    keywords: ["sponsored", "in partnership with", "advertorial", "promoted by"],
  },
  {
    id: "history-to-conflict",
    description:
      "Historical subject matter that connects to a present-day inter-state or " +
      "ethnic conflict.",
    handling: "Not published. Blocked outright per TZ §6.1.",
    blocking: true,
    keywords: ["disputed border history", "contested heritage claim"],
  },
  {
    id: "ai-generated",
    description: "Images, video or audio produced with AI.",
    handling:
      "Must carry an AI-generated label. Creating imagery that misrepresents a " +
      "real person is prohibited.",
    keywords: ["ai-generated", "deepfake", "synthetic media"],
  },
];

/**
 * The three approval levels (TZ §10.1). A draft cannot publish until the
 * approvers required by its tier have signed off.
 */
export interface ApprovalTierSpec {
  tier: ApprovalTier;
  /** Which material lands in this tier. */
  applies: string;
  /** Required sign-offs, in order. */
  approvers: readonly string[];
}

export const APPROVAL_TIERS: readonly ApprovalTierSpec[] = [
  {
    tier: "A",
    applies: "Routine factual, motivational or scientific content.",
    approvers: ["desk-editor", "native-editor"],
  },
  {
    tier: "B",
    applies:
      "Uzbekistan content, investment claims, named companies, partnerships, or " +
      "any financial figures.",
    approvers: ["fact-checker", "editor-in-chief"],
  },
  {
    tier: "C",
    applies:
      "State decisions, medical topics, historically sensitive subjects, or " +
      "sponsored material.",
    approvers: ["compliance", "editor-in-chief", "legal-if-required"],
  },
];

const TIER_ORDER: readonly ApprovalTier[] = ["A", "B", "C"];

/** The stricter of two tiers (C > B > A). */
export function maxTier(a: ApprovalTier, b: ApprovalTier): ApprovalTier {
  return TIER_ORDER.indexOf(a) >= TIER_ORDER.indexOf(b) ? a : b;
}

export function tierSpec(tier: ApprovalTier): ApprovalTierSpec {
  const spec = APPROVAL_TIERS.find((t) => t.tier === tier);
  if (!spec) throw new Error(`unknown approval tier: ${tier}`);
  return spec;
}

/** Outcome of the deterministic pre-LLM compliance screen. */
export interface ComplianceScreen {
  zone: ComplianceZone;
  /** Banned categories the text matched. Non-empty => zone is "RED". */
  bannedCategories: BannedCategory[];
  /** Yellow-zone rule ids the text matched. */
  yellowRules: string[];
  /** Handling instructions for the matched yellow-zone rules. */
  handling: string[];
  /** Minimum approval tier implied by the matches. */
  tier: ApprovalTier;
  /** Human-readable explanation for the audit trail. */
  reason: string;
}

/** Whole-word, case-insensitive, diacritic-tolerant match of a phrase. */
function containsPhrase(haystack: string, phrase: string): boolean {
  const needle = phrase.trim().toLowerCase();
  if (!needle) return false;
  // Escape regex metacharacters, then require a non-word boundary on each side
  // so "war" does not match "warehouse" or "forward".
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}([^\\p{L}\\p{N}]|$)`, "iu").test(haystack);
}

/**
 * Deterministic compliance screen, run BEFORE any paid LLM call. Catches the
 * obvious prohibited material for free and pre-labels yellow-zone handling.
 *
 * This is intentionally a first line of defence, not the whole gate: a story can
 * be political or sensational without using any listed keyword. The LLM
 * compliance classifier in `filter/rank.ts` is the semantic net behind it, and
 * a "GREEN" verdict here means only "no obvious violation", never "cleared".
 */
export function screenCompliance(text: string): ComplianceScreen {
  const hay = text.toLowerCase();

  const bannedCategories = BANNED_CATEGORIES.filter((cat) =>
    cat.keywords.some((kw) => containsPhrase(hay, kw)),
  ).map((cat) => cat.id);

  const matchedYellow = YELLOW_ZONE.filter((rule) =>
    rule.keywords.some((kw) => containsPhrase(hay, kw)),
  );

  // A blocking yellow-zone rule (history tied to live conflict) is a red result.
  const blockingYellow = matchedYellow.filter((r) => r.blocking);

  const isRed = bannedCategories.length > 0 || blockingYellow.length > 0;
  const zone: ComplianceZone = isRed
    ? "RED"
    : matchedYellow.length > 0
      ? "YELLOW"
      : "GREEN";

  // Yellow-zone material is at least tier C when it touches state decisions,
  // medicine, sensitive history or sponsorship (TZ §10.1 C-daraja).
  const tier: ApprovalTier = zone === "YELLOW" ? "C" : "A";

  const parts: string[] = [];
  if (bannedCategories.length) parts.push(`banned: ${bannedCategories.join(", ")}`);
  if (blockingYellow.length) {
    parts.push(`blocked rule: ${blockingYellow.map((r) => r.id).join(", ")}`);
  }
  const nonBlockingYellow = matchedYellow.filter((r) => !r.blocking);
  if (nonBlockingYellow.length) {
    parts.push(`yellow zone: ${nonBlockingYellow.map((r) => r.id).join(", ")}`);
  }

  return {
    zone,
    bannedCategories,
    yellowRules: matchedYellow.map((r) => r.id),
    handling: nonBlockingYellow.map((r) => r.handling),
    tier,
    reason: parts.join("; ") || "no prohibited signal detected",
  };
}

/**
 * The prohibition block injected into every research and generation prompt, so
 * the model never proposes material the compliance gate would reject anyway.
 */
export function prohibitionPromptBlock(): string {
  return [
    `ABSOLUTELY PROHIBITED — never return or write material about:`,
    ...BANNED_CATEGORIES.map((c) => `- ${c.description}`),
    ``,
    `This outlet does NOT publish breaking news, urgency, or negative agenda.`,
    `Do not treat a story as more valuable because it is urgent or dramatic.`,
    `Constructive value — solution, opportunity, progress, useful knowledge —`,
    `is what makes a story publishable here.`,
  ].join("\n");
}

/** The principles block injected into generation prompts. */
export function principlesPromptBlock(): string {
  return [
    `EDITORIAL PRINCIPLES:`,
    ...EDITORIAL_PRINCIPLES.map((p) => `- ${p.rule}`),
  ].join("\n");
}
