import { setDefaultResultOrder } from "node:dns";
import { config as loadDotenv } from "dotenv";
import { z } from "zod";

loadDotenv();

// Prefer IPv4 when resolving hostnames. Node 17+ defaults to "verbatim" (uses the
// order the resolver returns, often IPv6 first). On Docker/VPS hosts whose IPv6
// egress to Cloudflare is broken, that makes every request to mcp.higgsfield.ai
// (and other Cloudflare-fronted hosts) "fetch failed" — so image generation works
// on Windows dev but fails 100% in the Linux container. Forcing ipv4first fixes it.
// Override with NODE_OPTIONS=--dns-result-order=verbatim if ever needed.
try {
  setDefaultResultOrder("ipv4first");
} catch {
  /* older node / unsupported — ignore */
}

// Comma-separated string -> trimmed non-empty array
const csv = (val: string | undefined): string[] =>
  (val ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

const optionalUrl = z.preprocess(
  (val) => (val === "" ? undefined : val),
  z.string().url().optional(),
);

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  GEMINI_API_KEY: z.string().min(1, "GEMINI_API_KEY is required"),
  // Optional second Gemini key. When set, calls round-robin across both keys and
  // fail over to the other on a 429/503 — doubling free-tier throughput.
  GEMINI_API_KEY_2: z.string().optional(),
  GEMINI_MODEL: z.string().default("gemini-2.5-flash"),
  // Deadline for a single Gemini request. Media generation processes drafts one
  // at a time, so a call that never answers stalls every image behind it —
  // silently, since nothing errors and nothing logs. 90s is far above a normal
  // response (a few seconds) and well below "the queue is stuck".
  GEMINI_TIMEOUT_MS: z.coerce.number().int().positive().default(90_000),

  // ─── Media self-healing (see generate/media/mediaRecovery.ts) ───────────────
  // Automatically release assets abandoned mid-generation (every deploy kills
  // the worker) and requeue drafts stranded in FAILED once the provider is
  // healthy again, instead of needing `npm run media:retry -- --apply` by hand.
  MEDIA_AUTO_RETRY_ENABLED: z
    .string()
    .default("true")
    .transform((v) => v !== "false"),
  // Total generation runs per draft, counted by its MediaAsset rows. Bounds what
  // a systemic outage can cost in provider credits: past this the draft stays
  // FAILED and waits for a human, which is the signal something is really wrong.
  MEDIA_AUTO_RETRY_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),

  // Image generation provider:
  //  - "higgsfield-mcp": Higgsfield via MCP (OAuth, uses the subscription/app
  //    credit wallet). Run `npm run higgsfield:login` once.
  //  - "higgsfield": Higgsfield REST API (separate API credit wallet).
  //  - "gemini": Gemini image model, stored locally.
  // Defaults to "higgsfield-mcp", NOT "gemini": images must never silently fall
  // back to Gemini if this var goes missing from the env file. getMediaProvider()
  // documents "Higgsfield only" and a gemini default quietly contradicted it.
  IMAGE_PROVIDER: z.enum(["gemini", "higgsfield", "higgsfield-mcp"]).default("higgsfield-mcp"),
  MEDIA_GENERATION_ENABLED: z
    .string()
    .default("true")
    .transform((v) => !["false", "0", "no"].includes(v.trim().toLowerCase())),
  GEMINI_IMAGE_MODEL: z.string().default("gemini-2.5-flash-image"),
  // Where generated images are written, and the base URL they're served from.
  MEDIA_DIR: z.string().default("media"),
  PUBLIC_BASE_URL: z.string().optional(),
  MEDIA_STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  AWS_REGION: z.string().default("us-east-1"),
  AWS_S3_BUCKET: z.string().optional(),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  AWS_S3_ENDPOINT: optionalUrl,
  AWS_S3_FORCE_PATH_STYLE: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
  AWS_S3_PUBLIC_BASE_URL: optionalUrl,
  AWS_S3_KEY_PREFIX: z.string().default("media"),

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

  // Higgsfield image model. "soul_2" is Soul 2.0 — the editorial/realistic look
  // we want, 0.12 credits per 2k image. It does drift toward hallucinated signage,
  // which the wordless-retry loop in mediaService catches and regenerates.
  HIGGSFIELD_IMAGE_MODEL: z.string().default("soul_2"),
  // Higgsfield V2 SDK uses "KEY_ID:KEY_SECRET" credentials from cloud.higgsfield.ai.
  HIGGSFIELD_CREDENTIALS: z.string().optional(),
  // ElevenLabs, for the news presenter's cloned voice. The clone is private to
  // your ElevenLabs account, so it is only reachable with your own key —
  // Higgsfield's built-in ElevenLabs engine cannot see it.
  ELEVENLABS_API_KEY: z.string().optional(),
  ELEVENLABS_VOICE_ID: z.string().optional(),
  // eleven_v3 is the model with Uzbek coverage; the v2/turbo families are
  // limited to ~30 languages and do not include it.
  ELEVENLABS_MODEL_ID: z.string().default("eleven_v3"),

  MEDIA_FALLBACK_PROVIDER: z.enum(["none", "fal", "replicate"]).default("none"),
  FAL_API_KEY: z.string().optional(),
  REPLICATE_API_TOKEN: z.string().optional(),

  CONTENT_LANGUAGES: z.string().default("uz,ru,en"),
  // Legacy free-text topic list. Superseded by the seven fixed content verticals
  // in src/domain/verticals.ts (TZ §5.1/§5.2), which the research stage now
  // drives from. Retained only so an existing .env keeps parsing.
  RESEARCH_TOPICS: z
    .string()
    .default("World news,Breaking international news,Global technology and business"),
  // Reputable global outlets to prioritize / pull from during research.
  RESEARCH_SOURCES: z
    .string()
    .default("CNN,BBC,Reuters,Associated Press,Al Jazeera,The Guardian,Bloomberg"),

  // ─── Global Media Network strategy (TZ §5, §8, §13, §19) ───────────────────
  // Rollout phase, which determines the active market set (TZ §19):
  //   1 = pilot      — Japan, South Korea, China, Malaysia, Türkiye, UAE
  //   2 = expansion  — adds Germany, France, UK, Russia, Saudi Arabia, US, Brazil
  //   3 = full       — all 21 markets
  ROLLOUT_PHASE: z.coerce.number().int().min(1).max(3).default(1),
  // Explicit market allowlist (comma-separated codes, e.g. "JP,KR,AE"). When set
  // it overrides ROLLOUT_PHASE — use it to run a single market while testing, so
  // one pipeline run doesn't fan out across every pilot market at once.
  ACTIVE_MARKETS: z.string().default(""),
  // How many verticals each research cycle covers per market. The cycle picks
  // whichever verticals are furthest below their target share (TZ §5.2).
  VERTICALS_PER_RUN: z.coerce.number().int().positive().max(7).default(2),
  // Production formats the media pipeline can currently deliver. Video formats
  // require the video engine; drop them from this list until it is wired, and the
  // format balancer will distribute across the remaining ones instead.
  AVAILABLE_FORMATS: z.string().default("TEXT_POST,CAROUSEL,ARTICLE,INFOGRAPHIC"),
  // Minimum constructive value (0..1) — solution / opportunity / progress /
  // useful knowledge. The core editorial gate of the network (TZ §4).
  MIN_CONSTRUCTIVENESS: z.coerce.number().min(0).max(1).default(0.6),
  // Minimum verifiability (0..1): can every claim be traced to a named source
  // (TZ §4 source discipline, §15 "manba intizomi 100%").
  MIN_VERIFIABILITY: z.coerce.number().min(0).max(1).default(0.6),
  ENABLED_PLATFORMS: z.string().default("TELEGRAM"),
  // When true, the pipeline auto-approves and publishes each ready story to all
  // enabled platforms with no human approval step ("share itself"). Default off.
  AUTO_PUBLISH: z
    .string()
    .default("false")
    .transform((v) => v === "true"),

  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHANNEL_ID: z.string().optional(),
  // Bot that sends posts to the operator for Approve/Reject in Telegram.
  TELEGRAM_APPROVAL_BOT_TOKEN: z.string().optional(),

  // Basic-auth credentials for the web dashboard / API. When DASHBOARD_PASSWORD
  // is unset the dashboard is left open (with a startup warning).
  DASHBOARD_USERNAME: z.string().default("admin"),
  DASHBOARD_PASSWORD: z.string().optional(),

  // ReportageGO website (cross-post target). The agent POSTs approved articles
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
  // Production direct Mini App URL. When set, the bot points its menu button at
  // this URL and does not start a cloudflared quick tunnel.
  WEBAPP_PUBLIC_URL: optionalUrl,
  // Optional explicit path to the cloudflared binary; defaults to ./bin/cloudflared(.exe)
  // then a PATH lookup.
  CLOUDFLARED_PATH: z.string().optional(),

  // ─── Telegram/social card renderer ──────────────────────────────────────────
  //  - "builtin":  the original photo+gradient+headline card (card.ts).
  //  - "template": code reproduction of the Canva post template — rounded photo,
  //                REPORTAGE GO badge, red headline on white (templateCard.ts).
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

  // How Instagram posts are published:
  //  - "graph": official Meta Graph API (needs META_ACCESS_TOKEN + IG id).
  //  - "web":   browser automation of instagram.com via a persistent logged-in
  //             Chrome profile (like the Canva renderer). Run `npm run
  //             instagram:login` once. No API/token needed. Brittle + against
  //             Instagram ToS — use your own account at your own risk.
  INSTAGRAM_PUBLISHER: z.enum(["graph", "web"]).default("graph"),
  // Persistent Chromium profile holding the one-time Instagram login (gitignored).
  INSTAGRAM_PROFILE_DIR: z.string().default(".instagram-profile"),
  // Portable, plaintext storageState JSON (cookies) exported by `instagram:login`.
  // Used to seed the session into a fresh profile — the persistent profile's own
  // cookies are OS-encrypted and don't transfer between machines, so this JSON is
  // how a login done on one host bootstraps the headless server's browser.
  INSTAGRAM_STATE_FILE: z.string().default(".secrets/instagram-state.json"),
  // Run the Instagram browser headless. Default false: a real headed window is
  // far less likely to trip Instagram's automation checks.
  INSTAGRAM_HEADLESS: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
  // Browser channel ("chrome" = real Google Chrome, least detectable; empty =
  // Playwright's bundled Chromium).
  INSTAGRAM_BROWSER_CHANNEL: z.string().default("chrome"),
  // Optional account password, used ONLY to answer Instagram's "Continue as /
  // enter password" saved-login challenge when it appears (see reachFeed in
  // post.ts). Empty = never type a password (safer default). Automated password
  // entry is more bot-like and CANNOT pass a 2FA code prompt — if the account
  // has 2FA on, use the Meta Graph API instead. Never logged.
  INSTAGRAM_PASSWORD: z.string().default(""),
  // Where screenshots/HTML are dumped when a posting step fails.
  INSTAGRAM_DEBUG_DIR: z.string().default(".instagram-debug"),
  // Dry run: drive the whole web Create flow (login, open create, upload, caption)
  // but stop before the final Share — verifies posting works without publishing.
  INSTAGRAM_DRY_RUN: z
    .string()
    .default("false")
    .transform((v) => v === "true"),

  DASHBOARD_PORT: z.coerce.number().default(3000),
  // Network interface the dashboard binds to. Defaults to loopback so the
  // control API is never exposed on the LAN/internet by accident; set to
  // "0.0.0.0" only behind an authenticating reverse proxy.
  DASHBOARD_BIND: z.string().default("127.0.0.1"),
  APPROVERS: z.string().default(""),

  RESEARCH_CRON: z.string().default("0 */2 * * *"),
  // Preferred recency window, in hours. This is a SOFT preference passed to the
  // research prompt, not a hard cut: the network publishes constructive and
  // evergreen material (TZ §21 asks for a bank of evergreen ideas per market),
  // so a strong item is not discarded merely for being older. Default one week.
  RESEARCH_MAX_AGE_HOURS: z.coerce.number().int().positive().default(168),
  // Cap on how many top-ranked news items get drafted per pipeline run, so one
  // vertical can't flood the approval queue. Overflow is filtered out.
  // NOTE: each item fans out to (markets x platforms) drafts, so the real draft
  // volume is this number multiplied by the active market and platform counts.
  MAX_ITEMS_PER_RUN: z.coerce.number().int().positive().default(8),
  // Auto-delete news items (and their drafts/media/scheduled posts) older than
  // this many hours, keeping the agent DB lean. Published website articles live
  // in the website's own DB and are unaffected.
  //
  // Default 720h (30 days), NOT 24h. Two things now depend on this history:
  //   1. Dedupe. Items are de-duplicated by a unique contentHash on NewsItem. If
  //      retention is shorter than RESEARCH_MAX_AGE_HOURS, a purged evergreen
  //      story is re-discovered by the next cycle and published a second time.
  //   2. Mix balancing. The vertical/format balancers measure the last 30 days of
  //      SELECTED/DRAFTED items to find which shares are under-served. Purging at
  //      24h would leave them with almost no history to balance against, so the
  //      editorial mix would drift back to whatever research happened to return.
  NEWS_RETENTION_HOURS: z.coerce.number().int().positive().default(720),

  // ── News priority + strong filter (all live-tunable via the control panel) ──
  // Minimum editorial score (0..1) a story must reach to be SELECTED for
  // drafting. Higher = stricter. Defaults above the old 0.45 hard floor.
  MIN_SCORE: z.coerce.number().min(0).max(1).default(0.6),
  // Minimum relevance (0..1) to the vertical and the target market.
  MIN_RELEVANCE: z.coerce.number().min(0).max(1).default(0.5),
  // Lowest priority level that still gets drafted; anything below is dropped.
  // Note BREAKING is no longer assigned by the ranker (TZ §6) — setting it here
  // would filter out everything, so it is not a useful value.
  MIN_PRIORITY: z.enum(["LOW", "NORMAL", "HIGH", "BREAKING"]).default("NORMAL"),
  // Optional source/keyword gates (comma-separated, case-insensitive substring).
  // An allowlist is only enforced when non-empty. Applied before the LLM call.
  SOURCE_ALLOWLIST: z.string().default(""),
  SOURCE_BLOCKLIST: z.string().default(""),
  KEYWORD_ALLOWLIST: z.string().default(""),
  KEYWORD_BLOCKLIST: z.string().default(""),

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

if (raw.MEDIA_STORAGE_DRIVER === "s3") {
  const missing = [
    ["AWS_S3_BUCKET", raw.AWS_S3_BUCKET],
    ["AWS_ACCESS_KEY_ID", raw.AWS_ACCESS_KEY_ID],
    ["AWS_SECRET_ACCESS_KEY", raw.AWS_SECRET_ACCESS_KEY],
  ]
    .filter(([, value]) => !value)
    .map(([key]) => key);
  if (missing.length) {
    throw new Error(`Invalid environment configuration:\n  - ${missing.join(", ")} required when MEDIA_STORAGE_DRIVER=s3`);
  }
}

const VALID_PLATFORMS = [
  "TELEGRAM",
  "INSTAGRAM",
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

// ─── Active markets and formats (TZ §8, §19, §7.1) ───────────────────────────
// Resolved here rather than in the domain modules so the whole app shares one
// answer. `domain/markets.ts` stays a pure data/lookup module with no env
// dependency, so it can be unit-tested and reused by the website.

const VALID_MARKETS = [
  "JP", "KR", "MY", "CN", "TW",
  "TR", "DE", "FR", "UK", "SE", "AT", "RU", "ES",
  "AE", "KW", "QA", "OM", "SA",
  "US", "CA", "BR",
] as const;
type MarketName = (typeof VALID_MARKETS)[number];

// Phase → the markets it activates, mirroring the `phase` field in MARKETS.
const PHASE_MARKETS: Record<1 | 2 | 3, MarketName[]> = {
  1: ["JP", "KR", "MY", "CN", "TR", "AE"],
  2: ["JP", "KR", "MY", "CN", "TR", "AE", "DE", "FR", "UK", "RU", "SA", "US", "BR"],
  3: [...VALID_MARKETS],
};

const explicitMarkets = csv(raw.ACTIVE_MARKETS)
  .map((m) => m.toUpperCase())
  .filter((m): m is MarketName => (VALID_MARKETS as readonly string[]).includes(m));

const activeMarkets: MarketName[] = explicitMarkets.length
  ? explicitMarkets
  : PHASE_MARKETS[raw.ROLLOUT_PHASE as 1 | 2 | 3];

const VALID_FORMATS = [
  "SHORT_VIDEO", "EXPLAINER_VIDEO", "TEXT_POST", "CAROUSEL",
  "MINI_REPORTAGE", "INTERVIEW", "ARTICLE", "INFOGRAPHIC",
] as const;
type FormatName = (typeof VALID_FORMATS)[number];

const availableFormats = csv(raw.AVAILABLE_FORMATS)
  .map((f) => f.toUpperCase())
  .filter((f): f is FormatName => (VALID_FORMATS as readonly string[]).includes(f));

if (availableFormats.length === 0) {
  throw new Error(
    `AVAILABLE_FORMATS must list at least one of: ${VALID_FORMATS.join(", ")}`,
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
  // Global network strategy: the active market set and the formats the media
  // pipeline can currently produce.
  activeMarkets,
  availableFormats,
  sourceAllowlist: csv(raw.SOURCE_ALLOWLIST),
  sourceBlocklist: csv(raw.SOURCE_BLOCKLIST),
  keywordAllowlist: csv(raw.KEYWORD_ALLOWLIST),
  keywordBlocklist: csv(raw.KEYWORD_BLOCKLIST),
  approvers: csv(raw.APPROVERS),
  enabledPlatforms,
  // All configured Gemini keys (primary + optional second), de-duped. Calls
  // round-robin across these to spread free-tier load and fail over on 429/503.
  geminiKeys: [...new Set([raw.GEMINI_API_KEY, raw.GEMINI_API_KEY_2].filter((k): k is string => Boolean(k && k.trim())))],
  isProd: raw.NODE_ENV === "production",
} as const;

export type Env = typeof env;
