import { config as loadDotenv } from "dotenv";
import { z } from "zod";

loadDotenv();

// Comma-separated string -> trimmed non-empty array
const csv = (val: string | undefined): string[] =>
  (val ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  GEMINI_API_KEY: z.string().min(1, "GEMINI_API_KEY is required"),
  GEMINI_MODEL: z.string().default("gemini-2.5-flash"),

  // Image generation provider:
  //  - "higgsfield-mcp": Higgsfield via MCP (OAuth, uses the subscription/app
  //    credit wallet). Run `npm run higgsfield:login` once.
  //  - "higgsfield": Higgsfield REST API (separate API credit wallet).
  //  - "gemini": Gemini image model, stored locally.
  IMAGE_PROVIDER: z.enum(["gemini", "higgsfield", "higgsfield-mcp"]).default("gemini"),
  GEMINI_IMAGE_MODEL: z.string().default("gemini-2.5-flash-image"),
  // Where generated images are written, and the base URL they're served from.
  MEDIA_DIR: z.string().default("media"),
  PUBLIC_BASE_URL: z.string().optional(),

  // Brand card template: folder holding logo.png + headline font, and the
  // accent color for the red bar / fallbacks. The renderer overlays the logo,
  // accent bar, and headline onto each background photo.
  BRAND_DIR: z.string().default("brand"),
  BRAND_ACCENT_COLOR: z.string().default("#E11414"),
  // When true, generated backgrounds are composited into the branded news card
  // (logo + accent bar + headline). Set false to publish the raw photo.
  BRAND_CARD_ENABLED: z
    .string()
    .default("true")
    .transform((v) => v !== "false"),
  // Aspect ratio for the branded card background generation.
  BRAND_CARD_RATIO: z.enum(["4:5", "1:1", "9:16", "16:9"]).default("4:5"),

  // Higgsfield V2 SDK uses "KEY_ID:KEY_SECRET" credentials from cloud.higgsfield.ai.
  HIGGSFIELD_CREDENTIALS: z.string().optional(),
  MEDIA_FALLBACK_PROVIDER: z.enum(["none", "fal", "replicate"]).default("none"),
  FAL_API_KEY: z.string().optional(),
  REPLICATE_API_TOKEN: z.string().optional(),

  CONTENT_LANGUAGES: z.string().default("uz,ru,en"),
  RESEARCH_TOPICS: z
    .string()
    .default("World news,Breaking international news,Global technology and business"),
  // Reputable global outlets to prioritize / pull from during research.
  RESEARCH_SOURCES: z
    .string()
    .default("CNN,BBC,Reuters,Associated Press,Al Jazeera,The Guardian,Bloomberg"),
  ENABLED_PLATFORMS: z.string().default("TELEGRAM"),

  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHANNEL_ID: z.string().optional(),
  // Bot that sends posts to the operator for Approve/Reject in Telegram.
  TELEGRAM_APPROVAL_BOT_TOKEN: z.string().optional(),

  // Basic-auth credentials for the web dashboard / API. When DASHBOARD_PASSWORD
  // is unset the dashboard is left open (with a startup warning).
  DASHBOARD_USERNAME: z.string().default("admin"),
  DASHBOARD_PASSWORD: z.string().optional(),

  // ReportajGO website (cross-post target). The agent POSTs approved articles
  // to WEBSITE_API_URL/api/agent/posts with WEBSITE_API_KEY as a bearer token.
  WEBSITE_API_URL: z.string().default("http://localhost:3000"),
  WEBSITE_API_KEY: z.string().optional(),

  META_ACCESS_TOKEN: z.string().optional(),
  META_IG_BUSINESS_ID: z.string().optional(),
  META_FB_PAGE_ID: z.string().optional(),
  META_GRAPH_VERSION: z.string().default("v21.0"),

  DASHBOARD_PORT: z.coerce.number().default(3000),
  APPROVERS: z.string().default(""),

  RESEARCH_CRON: z.string().default("0 */2 * * *"),
  // Max age of a news item to be considered fresh. News older than this is
  // dropped — for a daily channel, anything from a previous day is stale.
  RESEARCH_MAX_AGE_HOURS: z.coerce.number().int().positive().default(24),
  // Cap on how many top-ranked news items get drafted per pipeline run, so a
  // high-volume topic can't flood the approval queue. Overflow is filtered out.
  MAX_ITEMS_PER_RUN: z.coerce.number().int().positive().default(8),
  TZ: z.string().default("Asia/Tashkent"),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
    .join("\n");
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

const raw = parsed.data;

const VALID_PLATFORMS = [
  "TELEGRAM",
  "INSTAGRAM",
  "FACEBOOK",
  "YOUTUBE",
  "WEBSITE",
] as const;
type PlatformName = (typeof VALID_PLATFORMS)[number];

const enabledPlatforms = csv(raw.ENABLED_PLATFORMS)
  .map((p) => p.toUpperCase())
  .filter((p): p is PlatformName => (VALID_PLATFORMS as readonly string[]).includes(p));

if (enabledPlatforms.length === 0) {
  throw new Error(
    `ENABLED_PLATFORMS must list at least one of: ${VALID_PLATFORMS.join(", ")}`,
  );
}

export const env = {
  ...raw,
  // Default the public base URL to the local dashboard so generated media has a
  // working URL out of the box. Override PUBLIC_BASE_URL for remote publishing.
  PUBLIC_BASE_URL: raw.PUBLIC_BASE_URL || `http://localhost:${raw.DASHBOARD_PORT}`,
  contentLanguages: csv(raw.CONTENT_LANGUAGES),
  researchTopics: csv(raw.RESEARCH_TOPICS),
  researchSources: csv(raw.RESEARCH_SOURCES),
  approvers: csv(raw.APPROVERS),
  enabledPlatforms,
  isProd: raw.NODE_ENV === "production",
} as const;

export type Env = typeof env;
