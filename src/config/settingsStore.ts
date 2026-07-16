import { z } from "zod";
import { prisma } from "../db/client.js";
import { env } from "./env.js";
import { logger } from "./logger.js";

const log = logger.child({ module: "settings" });

// The platforms the system understands. Mirrors the Platform enum / env list.
export const VALID_PLATFORMS = [
  "TELEGRAM",
  "INSTAGRAM",
  "YOUTUBE",
  "WEBSITE",
] as const;
export type PlatformName = (typeof VALID_PLATFORMS)[number];

/** The operator-editable runtime configuration. */
export interface RuntimeConfig {
  researchTopics: string[];
  contentLanguages: string[];
  enabledPlatforms: PlatformName[];
  geminiModel: string;
  researchCron: string;
  researchMaxAgeHours: number;
  maxItemsPerRun: number;
  /** Auto-approve + publish each ready story with no human approval step. */
  autoPublish: boolean;
  /**
   * When true, automatic research is paused: the cron is not registered and any
   * scheduled/in-flight pipeline run skips research (manual "run now" still
   * works). Persisted so a restart doesn't silently resume research.
   */
  researchPaused: boolean;
}

// One DB row holds the whole override blob as JSON under this key.
const SETTINGS_KEY = "runtime";

// Validates an incoming partial update from the control panel. Every field is
// optional (callers may patch one setting at a time) but, when present, must be
// well-formed — empty arrays/blank strings are rejected so the pipeline always
// has something to run with.
const nonEmptyStr = z.string().trim().min(1);
const updateSchema = z
  .object({
    researchTopics: z.array(nonEmptyStr).min(1),
    contentLanguages: z.array(nonEmptyStr).min(1),
    enabledPlatforms: z.array(z.enum(VALID_PLATFORMS)).min(1),
    geminiModel: nonEmptyStr,
    researchCron: nonEmptyStr,
    researchMaxAgeHours: z.coerce.number().int().positive().max(168),
    maxItemsPerRun: z.coerce.number().int().positive().max(50),
    autoPublish: z.boolean(),
    researchPaused: z.boolean(),
  })
  .partial()
  .strict();

export type RuntimeConfigUpdate = z.infer<typeof updateSchema>;

/** Defaults sourced from validated env — used when no override is stored. */
function envDefaults(): RuntimeConfig {
  return {
    researchTopics: [...env.researchTopics],
    contentLanguages: [...env.contentLanguages],
    enabledPlatforms: [...env.enabledPlatforms] as PlatformName[],
    geminiModel: env.GEMINI_MODEL,
    researchCron: env.RESEARCH_CRON,
    researchMaxAgeHours: env.RESEARCH_MAX_AGE_HOURS,
    maxItemsPerRun: env.MAX_ITEMS_PER_RUN,
    autoPublish: env.AUTO_PUBLISH,
    researchPaused: false,
  };
}

// In-process snapshot of the last resolved config. We still refresh from the DB
// on each read so separate app/worker/bot containers see dashboard edits without
// a restart.
let cache: RuntimeConfig | null = null;

// Serializes read-modify-write of the shared config blob. Without it, a pause
// that interleaves with a settings edit (both read the snapshot, then upsert the
// whole blob) can lose one write — last-writer-wins. All mutators run through it.
let writeChain: Promise<unknown> = Promise.resolve();
function withConfigLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeChain.then(fn, fn);
  writeChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function dedupeUpper(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))];
}

async function loadOverrides(): Promise<Partial<RuntimeConfig>> {
  let row: { value: string } | null;
  try {
    row = await prisma.setting.findUnique({ where: { key: SETTINGS_KEY } });
  } catch (err) {
    // Fail open: if the DB is unreachable (e.g. Postgres down), fall back to env
    // defaults instead of crashing every config read. Overrides resume once the
    // DB is back. This also lets the standalone media scripts run without docker.
    log.warn({ err }, "could not load settings overrides (DB unreachable); using env defaults");
    return {};
  }
  if (!row) return {};
  try {
    const raw = JSON.parse(row.value) as Record<string, unknown>;
    // Drop any platforms no longer supported (e.g. a removed FACEBOOK) so one
    // stale value can't invalidate the whole stored config.
    if (Array.isArray(raw.enabledPlatforms)) {
      const valid = (VALID_PLATFORMS as readonly string[]);
      raw.enabledPlatforms = raw.enabledPlatforms.filter((p) => valid.includes(p as string));
      if ((raw.enabledPlatforms as unknown[]).length === 0) delete raw.enabledPlatforms;
    }
    const parsed = updateSchema.parse(raw);
    return parsed as Partial<RuntimeConfig>;
  } catch (err) {
    log.warn({ err }, "stored settings invalid; ignoring overrides");
    return {};
  }
}

function merge(base: RuntimeConfig, over: Partial<RuntimeConfig>): RuntimeConfig {
  return {
    researchTopics: over.researchTopics ?? base.researchTopics,
    contentLanguages: over.contentLanguages ?? base.contentLanguages,
    enabledPlatforms: over.enabledPlatforms ?? base.enabledPlatforms,
    geminiModel: over.geminiModel ?? base.geminiModel,
    researchCron: over.researchCron ?? base.researchCron,
    researchMaxAgeHours: over.researchMaxAgeHours ?? base.researchMaxAgeHours,
    maxItemsPerRun: over.maxItemsPerRun ?? base.maxItemsPerRun,
    autoPublish: over.autoPublish ?? base.autoPublish,
    researchPaused: over.researchPaused ?? base.researchPaused,
  };
}

/** Resolved runtime config (DB overrides applied over env). */
export async function getRuntimeConfig(): Promise<RuntimeConfig> {
  const resolved = merge(envDefaults(), await loadOverrides());
  cache = resolved;
  return resolved;
}

/** Prime the cache at boot so sync-ish consumers are warm. */
export async function initSettings(): Promise<RuntimeConfig> {
  cache = null;
  return getRuntimeConfig();
}

/**
 * Apply a partial settings update: validate, persist the full merged override
 * blob, and refresh the cache. Returns { config, changedCron } so the caller
 * can re-register the research cron only when it actually changed.
 */
export async function updateRuntimeConfig(
  patch: unknown,
): Promise<{ config: RuntimeConfig; changedCron: boolean }> {
  const result = updateSchema.safeParse(patch);
  if (!result.success) {
    const msg = result.error.issues
      .map((i) => `${i.path.join(".") || "settings"}: ${i.message}`)
      .join("; ");
    throw new Error(msg);
  }
  const clean = result.data;
  if (clean.researchTopics) clean.researchTopics = dedupeUpper(clean.researchTopics);
  if (clean.contentLanguages) {
    clean.contentLanguages = dedupeUpper(clean.contentLanguages.map((l) => l.toLowerCase()));
  }
  if (clean.enabledPlatforms) {
    clean.enabledPlatforms = [...new Set(clean.enabledPlatforms)] as PlatformName[];
  }

  return withConfigLock(async () => {
    const current = await getRuntimeConfig();
    const next = merge(current, clean as Partial<RuntimeConfig>);
    const changedCron = next.researchCron !== current.researchCron;

    const overrides = await persistConfig(next);
    log.info({ overrides, changedCron }, "runtime settings updated");
    return { config: next, changedCron };
  });
}

/**
 * Persist a fully-merged config: store only the fields that differ from env
 * defaults (keeps the blob lean) and refresh the in-memory cache. Returns the
 * override blob that was written, for logging.
 */
async function persistConfig(next: RuntimeConfig): Promise<Partial<RuntimeConfig>> {
  const defaults = envDefaults();
  const overrides: Partial<RuntimeConfig> = {};
  (Object.keys(next) as (keyof RuntimeConfig)[]).forEach((k) => {
    if (JSON.stringify(next[k]) !== JSON.stringify(defaults[k])) {
      (overrides as Record<string, unknown>)[k] = next[k];
    }
  });

  await prisma.setting.upsert({
    where: { key: SETTINGS_KEY },
    create: { key: SETTINGS_KEY, value: JSON.stringify(overrides) },
    update: { value: JSON.stringify(overrides) },
  });

  cache = next;
  return overrides;
}

/**
 * Persist the research-paused flag (and refresh the cache) so pause/resume
 * survives restarts and every in-process consumer sees it immediately.
 */
export async function setResearchPaused(paused: boolean): Promise<void> {
  await withConfigLock(async () => {
    const current = await getRuntimeConfig();
    if (current.researchPaused === paused) return;
    await persistConfig({ ...current, researchPaused: paused });
    log.info({ researchPaused: paused }, "research pause state updated");
  });
}

/**
 * Read the research-paused flag straight from the DB, bypassing the in-memory
 * cache. Workers may run in a SEPARATE process from the dashboard/bot that sets
 * the flag (horizontal scaling via `npm run worker`), so their boot-warmed cache
 * would otherwise never see a pause. Cheap enough for the few checks per run.
 */
export async function isResearchPaused(): Promise<boolean> {
  const row = await prisma.setting.findUnique({ where: { key: SETTINGS_KEY } });
  if (!row) return false;
  try {
    return (JSON.parse(row.value) as { researchPaused?: unknown }).researchPaused === true;
  } catch {
    return false;
  }
}
