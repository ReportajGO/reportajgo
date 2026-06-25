import { getRuntimeConfig } from "../config/settingsStore.js";
import { logger } from "../config/logger.js";
import { prisma } from "../db/client.js";
import { generateJson } from "../research/gemini.js";

const log = logger.child({ module: "dedupe" });

// How far back to look for already-drafted stories, so the same event from a
// later research run (different outlet) isn't posted twice. Multiple of the
// freshness window.
const ANCHOR_WINDOW_MULT = 2;
// Token-similarity threshold for the offline fallback clusterer.
const TITLE_JACCARD = 0.6;
const COMBINED_JACCARD = 0.5;

interface Item {
  id: string;
  title: string;
  summary: string;
  score: number | null;
  publishedAt: Date | null;
  /** Already drafted in a recent run — wins its cluster and is never dropped. */
  locked: boolean;
}

/**
 * Collapse same-story duplicates among SELECTED items. The same event reported
 * by several outlets (or surfaced again in a later run) is reduced to ONE item;
 * the rest are marked FILTERED_OUT so only a single post is produced.
 */
export async function dedupeSelectedItems(): Promise<{ merged: number }> {
  const { researchMaxAgeHours } = await getRuntimeConfig();

  const selected = await prisma.newsItem.findMany({
    where: { status: "SELECTED" },
    orderBy: [{ score: "desc" }, { publishedAt: "desc" }],
    select: { id: true, title: true, summary: true, score: true, publishedAt: true },
  });
  if (selected.length === 0) return { merged: 0 };

  // Anchors: recently drafted stories. A new item matching one of these is a
  // cross-run duplicate and gets dropped.
  const anchorCutoff = new Date(Date.now() - researchMaxAgeHours * ANCHOR_WINDOW_MULT * 3600_000);
  const anchors = await prisma.newsItem.findMany({
    where: { status: "DRAFTED", fetchedAt: { gte: anchorCutoff } },
    orderBy: { fetchedAt: "desc" },
    take: 80,
    select: { id: true, title: true, summary: true, score: true, publishedAt: true },
  });

  const items: Item[] = [
    ...selected.map((i) => ({ ...i, locked: false })),
    ...anchors.map((i) => ({ ...i, locked: true })),
  ];
  if (items.length < 2) return { merged: 0 };

  let clusters: string[][];
  try {
    clusters = await geminiClusters(items);
  } catch (err) {
    log.warn({ err }, "gemini dedupe failed; using token similarity");
    clusters = tokenClusters(items);
  }

  const byId = new Map(items.map((i) => [i.id, i]));
  const toDrop: { id: string; keep: string }[] = [];

  for (const groupIds of clusters) {
    const group = groupIds.map((id) => byId.get(id)).filter((x): x is Item => Boolean(x));
    if (group.length < 2) continue;

    // Keep an anchor if present (story already in the pipeline); otherwise the
    // highest-scored, freshest SELECTED item.
    const anchor = group.find((g) => g.locked);
    const keep =
      anchor ??
      [...group].sort(
        (a, b) =>
          (b.score ?? 0) - (a.score ?? 0) ||
          (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0),
      )[0]!;

    for (const g of group) {
      if (g.id !== keep.id && !g.locked) toDrop.push({ id: g.id, keep: keep.id });
    }
  }

  if (toDrop.length === 0) {
    log.info({ candidates: selected.length }, "no cross-source duplicates found");
    return { merged: 0 };
  }

  for (const d of toDrop) {
    await prisma.newsItem.update({
      where: { id: d.id },
      data: {
        status: "FILTERED_OUT",
        rankReasons: `duplicate of ${d.keep} (same story, different source)`,
      },
    });
  }
  log.info({ merged: toDrop.length, kept: selected.length - toDrop.length }, "cross-source dedupe complete");
  return { merged: toDrop.length };
}

// ── Gemini semantic clustering ───────────────────────────────────────────────
interface ClusterReply {
  groups?: string[][];
}

async function geminiClusters(items: Item[]): Promise<string[][]> {
  const list = items
    .map((i, n) => `${n + 1}. id=${i.id} | ${oneLine(i.title)} — ${oneLine(i.summary).slice(0, 180)}`)
    .join("\n");

  const prompt = [
    `You are deduplicating a news feed. Group items that report the SAME underlying`,
    `event/story, even if they come from different outlets, use different wording, or`,
    `are written in different languages. Items about DIFFERENT events must stay in`,
    `separate groups. Be conservative: only group items you are confident are the`,
    `same specific event (same who/what/when), not merely the same topic.`,
    ``,
    `Return ONLY JSON: { "groups": string[][] } — each inner array lists the item ids`,
    `that are the same story. Every id must appear exactly once. Singletons are fine.`,
    ``,
    `ITEMS:`,
    list,
  ].join("\n");

  const raw = await generateJson<ClusterReply>(prompt, 0);
  const groups = Array.isArray(raw.groups) ? raw.groups : [];
  // Keep only known ids.
  const known = new Set(items.map((i) => i.id));
  return groups
    .map((g) => (Array.isArray(g) ? g.filter((id) => known.has(id)) : []))
    .filter((g) => g.length > 0);
}

// ── Offline token-similarity clustering (fallback) ───────────────────────────
const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with", "at", "by",
  "from", "as", "is", "are", "was", "were", "be", "has", "have", "after", "over",
  "amid", "into", "new", "says", "say", "will", "its", "his", "her", "their",
]);

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((t) => (t.length >= 3 || /^\d+$/.test(t)) && !STOPWORDS.has(t)),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

function tokenClusters(items: Item[]): string[][] {
  const titleTok = items.map((i) => tokenize(i.title));
  const combTok = items.map((i) => tokenize(`${i.title} ${i.summary}`));

  // Union-find over near-duplicate pairs.
  const parent = items.map((_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x]!)));
  const union = (a: number, b: number) => {
    parent[find(a)] = find(b);
  };

  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const sameStory =
        jaccard(titleTok[i]!, titleTok[j]!) >= TITLE_JACCARD ||
        jaccard(combTok[i]!, combTok[j]!) >= COMBINED_JACCARD;
      if (sameStory) union(i, j);
    }
  }

  const groups = new Map<number, string[]>();
  items.forEach((it, i) => {
    const root = find(i);
    const g = groups.get(root) ?? [];
    g.push(it.id);
    groups.set(root, g);
  });
  return [...groups.values()];
}

function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}
