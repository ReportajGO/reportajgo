// Editorial ranking + compliance classification.
//
// Source of truth: TZ §4 (tamoyillar), §6 (taqiqlangan kontent), §6.1 (sariq
// zona), §10.1 (tasdiqlash darajalari), §15 (KPI).
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT CHANGED, AND WHY
//
// The previous ranker asked one question: how newsworthy is this? It rewarded
// "major, time-sensitive story of wide importance happening now" with the top
// BREAKING level, which put urgency at the centre of selection.
//
// The new rubric scores four things instead, and refuses on the first:
//   1. COMPLIANCE     — is it a prohibited category? (hard gate, TZ §6)
//   2. CONSTRUCTIVENESS — solution / opportunity / progress / knowledge (TZ §4)
//   3. VERIFIABILITY  — can every claim be traced to a named source (TZ §4)
//   4. RELEVANCE      — does this specific market's audience have a reason to care
//
// The ranker no longer assigns BREAKING at all. Urgency is not a virtue here.
// ─────────────────────────────────────────────────────────────────────────────

import { logger } from "../config/logger.js";
import {
  BANNED_CATEGORIES,
  YELLOW_ZONE,
  maxTier,
  screenCompliance,
} from "../domain/editorial.js";
import { findMarket } from "../domain/markets.js";
import { coercePriority, priorityToScore } from "../domain/priority.js";
import type {
  ApprovalTier,
  BannedCategory,
  ComplianceVerdict,
  ComplianceZone,
  RankVerdict,
} from "../domain/types.js";
import { findVertical } from "../domain/verticals.js";
import { generateJson } from "../research/gemini.js";

const log = logger.child({ module: "rank" });

interface RawVerdict {
  score?: number;
  relevance?: number;
  constructiveness?: number;
  verifiability?: number;
  priority?: string;
  reasons?: string;
  complianceZone?: string;
  bannedCategories?: unknown;
  yellowRules?: unknown;
}

export interface RankInput {
  title: string;
  summary: string;
  sourceName?: string | null;
  topic?: string | null;
  vertical?: string | null;
  market?: string | null;
  uzbekistanQuota?: boolean;
  constructiveAngle?: string | null;
  additionalSources?: string[];
}

function buildPrompt(item: RankInput): string {
  const vertical = item.vertical ? findVertical(item.vertical) : undefined;
  const market = item.market ? findMarket(item.market) : undefined;

  return [
    `You are the compliance and editorial reviewer for Reportage GO, an`,
    `international CONSTRUCTIVE media network. Reportage GO does NOT publish`,
    `breaking news, political news, or negative agenda. Assess this candidate.`,
    ``,
    `CANDIDATE`,
    `Title: ${item.title}`,
    `Summary: ${item.summary}`,
    `Stated constructive angle: ${item.constructiveAngle?.trim() || "(none given)"}`,
    `Source: ${item.sourceName ?? "unknown"}`,
    `Corroborating sources: ${item.additionalSources?.length ?? 0}`,
    `Vertical: ${vertical ? `${vertical.nameEn} — ${vertical.scope}` : "unspecified"}`,
    `Target market: ${market ? market.nameEn : "unspecified"}`,
    item.uzbekistanQuota
      ? `This is UZBEKISTAN-QUOTA material: it must be positive, useful AND evidence-based.`
      : ``,
    ``,
    `STEP 1 — COMPLIANCE (decisive).`,
    `Classify complianceZone as exactly one of:`,
    `- "RED":    falls into a prohibited category. Set bannedCategories.`,
    `- "YELLOW": publishable only with special handling. Set yellowRules.`,
    `- "GREEN":  no restriction.`,
    ``,
    `Prohibited categories (=> RED), use these exact ids:`,
    ...BANNED_CATEGORIES.map((c) => `- ${c.id}: ${c.description}`),
    ``,
    `Yellow-zone rules (=> YELLOW), use these exact ids:`,
    ...YELLOW_ZONE.map((r) => `- ${r.id}: ${r.description} Handling: ${r.handling}`),
    ``,
    `Be strict. If the story's core is politics, conflict, crime, disaster,`,
    `scandal or accusation, it is RED even when it has an economic sub-angle.`,
    ``,
    `STEP 2 — EDITORIAL SCORING (0..1 each).`,
    `- constructiveness: does it centre on a solution, opportunity, measurable`,
    `  progress, or genuinely useful knowledge? Problem-centred = low.`,
    `- verifiability: can every claim be traced to a named, credible source?`,
    `  Vague figures, unnamed sources or unverified praise = low.`,
    `- relevance: does this specific market's audience have a real reason to care?`,
    `- score: overall editorial value = constructiveness x verifiability x relevance,`,
    `  weighted by how well it fits the vertical.`,
    ``,
    `Do NOT raise any score because the story is urgent, dramatic or exclusive.`,
    ``,
    `STEP 3 — PRIORITY. One of "HIGH", "NORMAL", "LOW".`,
    `- "HIGH":   strong constructive value, well sourced, clearly relevant.`,
    `- "NORMAL": genuine and usable, but routine.`,
    `- "LOW":    thin, filler, promotional, or narrow interest.`,
    `Never return "BREAKING" — this outlet does not publish breaking news.`,
    ``,
    `Return ONLY JSON:`,
    `{`,
    `  "complianceZone": "GREEN"|"YELLOW"|"RED",`,
    `  "bannedCategories": string[],`,
    `  "yellowRules": string[],`,
    `  "constructiveness": 0..1,`,
    `  "verifiability": 0..1,`,
    `  "relevance": 0..1,`,
    `  "score": 0..1,`,
    `  "priority": "HIGH"|"NORMAL"|"LOW",`,
    `  "reasons": string`,
    `}`,
  ]
    .filter(Boolean)
    .join("\n");
}

const BANNED_IDS = new Set<string>(BANNED_CATEGORIES.map((c) => c.id));
const YELLOW_IDS = new Set<string>(YELLOW_ZONE.map((r) => r.id));

/** Keep only ids the schema recognises, so a hallucinated label can't leak through. */
function cleanBanned(raw: unknown): BannedCategory[] {
  if (!Array.isArray(raw)) return [];
  const ids = raw
    .map((v) => (typeof v === "string" ? v.trim().toUpperCase() : ""))
    .filter((v) => BANNED_IDS.has(v)) as BannedCategory[];
  return [...new Set(ids)];
}

function cleanYellow(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const ids = raw
    .map((v) => (typeof v === "string" ? v.trim().toLowerCase() : ""))
    .filter((v) => YELLOW_IDS.has(v));
  return [...new Set(ids)];
}

function coerceZone(raw: unknown): ComplianceZone | null {
  if (typeof raw !== "string") return null;
  const up = raw.trim().toUpperCase();
  return up === "RED" || up === "YELLOW" || up === "GREEN" ? up : null;
}

/**
 * Merge the deterministic keyword screen with the model's classification, taking
 * the STRICTER of the two on every axis.
 *
 * Neither source is trusted alone: the keyword screen has no semantics (a
 * political story with no listed keyword passes it), and the model can miss or
 * soften a violation. Taking the stricter reading means a RED from either side
 * is final — the safe direction for a network whose reputation is the product.
 */
function mergeCompliance(
  modelZone: ComplianceZone | null,
  modelBanned: BannedCategory[],
  modelYellow: string[],
  screen: ReturnType<typeof screenCompliance>,
  uzbekistanQuota: boolean,
): ComplianceVerdict {
  const bannedCategories = [...new Set([...screen.bannedCategories, ...modelBanned])];
  const yellowRules = [...new Set([...screen.yellowRules, ...modelYellow])];

  // RED wins over everything; then YELLOW from either source.
  const zone: ComplianceZone =
    modelZone === "RED" || screen.zone === "RED" || bannedCategories.length > 0
      ? "RED"
      : modelZone === "YELLOW" || screen.zone === "YELLOW" || yellowRules.length > 0
        ? "YELLOW"
        : "GREEN";

  // Approval tier (TZ §10.1): yellow-zone material is tier C; Uzbekistan,
  // investment and company material is at least tier B; everything else tier A.
  let tier: ApprovalTier = zone === "YELLOW" ? "C" : "A";
  if (uzbekistanQuota) tier = maxTier(tier, "B");
  tier = maxTier(tier, screen.tier);

  const reasons: string[] = [];
  if (bannedCategories.length) reasons.push(`prohibited: ${bannedCategories.join(", ")}`);
  if (yellowRules.length) reasons.push(`yellow zone: ${yellowRules.join(", ")}`);
  if (!reasons.length) reasons.push("no restriction");
  // Record when the two sources disagreed — useful for tuning the keyword lists.
  if (modelZone && modelZone !== screen.zone) {
    reasons.push(`(screen=${screen.zone}, model=${modelZone})`);
  }

  return { zone, bannedCategories, yellowRules, tier, reason: reasons.join("; ") };
}

/**
 * Score a candidate for publication and classify its compliance.
 *
 * The keep/drop decision lives in the filter service so this stays a pure
 * assessor — except for compliance, which is reported here as a verdict the
 * filter is required to honour.
 */
export async function rankNews(item: RankInput): Promise<RankVerdict> {
  // The deterministic screen runs regardless of the LLM outcome, so obvious
  // prohibited material is caught even if the model is generous.
  const screen = screenCompliance(`${item.title} ${item.summary}`);

  // Short-circuit: a keyword-level RED needs no paid call. Saves a request per
  // prohibited item, which at 21 markets x 7 verticals is a real cost.
  if (screen.zone === "RED") {
    log.info(
      { title: item.title, banned: screen.bannedCategories },
      "candidate rejected by compliance screen; skipping LLM ranking",
    );
    return {
      score: 0,
      relevance: 0,
      priority: "LOW",
      constructiveness: 0,
      verifiability: 0,
      reasons: `compliance: ${screen.reason}`,
      compliance: {
        zone: "RED",
        bannedCategories: screen.bannedCategories,
        yellowRules: screen.yellowRules,
        tier: screen.tier,
        reason: screen.reason,
      },
    };
  }

  try {
    const raw = await generateJson<RawVerdict>(buildPrompt(item));

    // The call isn't schema-constrained, so tolerate quoted numbers and missing
    // fields. When a numeric is genuinely absent, derive it from the explicit
    // priority rather than collapsing to 0 — otherwise a good item would be
    // silently dropped by the score gate.
    const rawScore = parseUnit(raw.score);
    const priority = coercePriority(raw.priority, rawScore ?? 0);
    const score = rawScore ?? priorityToScore(priority);
    const relevance = parseUnit(raw.relevance) ?? score;
    const constructiveness = parseUnit(raw.constructiveness) ?? score;
    const verifiability = parseUnit(raw.verifiability) ?? score;

    const compliance = mergeCompliance(
      coerceZone(raw.complianceZone),
      cleanBanned(raw.bannedCategories),
      cleanYellow(raw.yellowRules),
      screen,
      item.uzbekistanQuota ?? false,
    );

    return {
      score,
      relevance,
      priority,
      constructiveness,
      verifiability,
      reasons: raw.reasons ?? "",
      compliance,
    };
  } catch (err) {
    // A transient failure (Gemini outage, malformed JSON) must NOT masquerade as
    // an editorial reject — that would permanently drop a good item. Throw so
    // the filter stage leaves it NEW to be re-ranked next run.
    log.warn({ err, title: item.title }, "ranking failed; leaving item for retry");
    throw err instanceof Error ? err : new Error("ranking failed");
  }
}

/** Parse a model-provided 0..1 value, tolerating numeric strings. null if absent/unparseable. */
function parseUnit(n: unknown): number | null {
  const v = typeof n === "number" ? n : typeof n === "string" ? Number(n.trim()) : NaN;
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : null;
}
