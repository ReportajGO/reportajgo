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

  // Higgsfield image model. "soul_2" (editorial) hallucinates fake/garbled text;
  // "nano_banana_pro" follows the no-text instruction and gives clean photos.
  HIGGSFIELD_IMAGE_MODEL: z.string().default("nano_banana_pro"),
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
  // Public base used to build the article link shown inside social posts. The
  // ingest API may run on a private/localhost host (WEBSITE_API_URL); set this
  // to the public site origin (e.g. https://reportajgo.uz) so the "read full
  // story" link in each Telegram post is clickable. Defaults to WEBSITE_API_URL.
  WEBSITE_PUBLIC_URL: z.string().optional(),

  // ─── Social post footer (Telegram channel signature) ────────────────────────
  // Lead emoji before the bold headline (the screenshot uses the UZ flag).
  BRAND_FLAG_EMOJI: z.string().default("🇺🇿"),
  // Channel/profile links rendered as the footer of each Telegram post. When a
  // URL is set the label becomes a clickable link; otherwise it shows plain.
  BRAND_TELEGRAM_URL: z.string().optional(),
  BRAND_INSTAGRAM_URL: z.string().optional(),
  BRAND_YOUTUBE_URL: z.string().optional(),

  // Premium/custom emoji IDs (from a bot-owned custom_emoji set, e.g.
  // t.me/addemoji/ApplicationEmoji). When set, the matching slot renders the
  // animated custom emoji with the plain emoji as fallback; when empty it stays
  // plain. The posting bot must own the set (or have a Fragment username).
  TG_EMOJI_LEAD: z.string().optional(), // before the headline (🇺🇿)
  TG_EMOJI_TELEGRAM: z.string().optional(), // footer 📣
  TG_EMOJI_INSTAGRAM: z.string().optional(), // footer 📸
  TG_EMOJI_YOUTUBE: z.string().optional(), // footer ▶️
  TG_EMOJI_LINK: z.string().optional(), // site link 🔗

  // Telegram Mini App: expose the website admin over a public HTTPS cloudflared
  // quick tunnel and wire it to the approval bot's menu button ("app" inside the
  // bot). Quick-tunnel hostnames are ephemeral, so the agent re-sets the button
  // each time the tunnel (re)connects. Target origin = WEBSITE_API_URL.
  WEBAPP_ENABLED: z
    .string()
    .default("true")
    .transform((v) => v !== "false"),
  // Path appended to the tunnel origin (default locale is "ru", admin at /ru/admin).
  WEBAPP_PATH: z.string().default("/ru/admin"),
  WEBAPP_MENU_TEXT: z.string().default("Admin Panel"),
  // Optional explicit path to the cloudflared binary; defaults to ./bin/cloudflared(.exe)
  // then a PATH lookup.
  CLOUDFLARED_PATH: z.string().optional(),

  // ─── Telegram/social card renderer ──────────────────────────────────────────
  //  - "builtin":  the original photo+gradient+headline card (card.ts).
  //  - "template": code reproduction of the Canva post template — rounded photo,
  //                REPORTAJGO badge, red headline on white (templateCard.ts).
  //  - "canva":    drive the Canva editor (Playwright). Unsafe/brittle — see
  //                [[canva-card-renderer]]; not for production.
  CARD_RENDERER: z.enum(["builtin", "template", "canva"]).default("builtin"),
  // The Canva design/template edit URL (…canva.com/design/<id>/edit).
  CANVA_TEMPLATE_URL: z.string().optional(),
  // Persistent Chromium profile holding the one-time Canva login (gitignored).
  CANVA_PROFILE_DIR: z.string().default(".canva-profile"),
  // Run the Canva browser headless. Default false: headless Chromium trips
  // Canva's Cloudflare bot-check; a real headed Chrome usually passes.
  CANVA_HEADLESS: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
  // Browser channel to drive ("chrome" = real Google Chrome, least detectable;
  // empty = Playwright's bundled Chromium).
  CANVA_BROWSER_CHANNEL: z.string().default("chrome"),
  // Where screenshots/HTML are dumped when a Canva step fails (for calibration).
  CANVA_DEBUG_DIR: z.string().default(".canva-debug"),
  // Calibration map (coordinates of headline/image elements) — see brand/canva-template.json.
  CANVA_TEMPLATE_MAP: z.string().default("brand/canva-template.json"),

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
  // Auto-delete news items (and their drafts/media/scheduled posts) older than
  // this many hours, keeping the agent DB lean. Published website articles live
  // in the website's own DB and are unaffected.
  NEWS_RETENTION_HOURS: z.coerce.number().int().positive().default(24),
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
  // Public site origin for in-post article links; falls back to the ingest host.
  WEBSITE_PUBLIC_URL: raw.WEBSITE_PUBLIC_URL || raw.WEBSITE_API_URL,
  contentLanguages: csv(raw.CONTENT_LANGUAGES),
  researchTopics: csv(raw.RESEARCH_TOPICS),
  researchSources: csv(raw.RESEARCH_SOURCES),
  approvers: csv(raw.APPROVERS),
  enabledPlatforms,
  isProd: raw.NODE_ENV === "production",
} as const;

export type Env = typeof env;
