# ReportajGO Agent

An AI agent that researches regional news, filters & ranks it, generates
per-platform posts **and** AI media (images/videos), queues everything for
**human approval**, and publishes to social media on schedule.

> Content focus: **Uzbek / Russian** regional news (Central Asia).
> Posting model: **human-in-the-loop** — nothing goes live without approval.

## Pipeline

```
RESEARCH ─► FILTER & RANK ─► GENERATE COPY ─► GENERATE MEDIA ─► APPROVAL ─► SCHEDULE ─► PUBLISH
(Gemini +    (dedupe,         (per-platform     (Higgsfield      (human       (BullMQ)    (Telegram,
 Search)     score, select)   styles)           img+video)       dashboard)               IG, FB, ...)
```

## Tech stack

- **Node.js + TypeScript** (ESM)
- **Gemini** (`@google/genai`) with Google Search grounding — research & copy
- **Higgsfield** — image & video generation (behind a provider interface, with fal/replicate fallback)
- **Postgres** + **Prisma** — data model & audit trail
- **Redis** + **BullMQ** — scheduling & job queue
- **Telegraf** — Telegram publishing (first platform)

## Status — build phases

| Phase | Scope | State |
|-------|-------|-------|
| 0 | Scaffold: config, schema, Docker, queue wiring | ✅ done |
| 1 | Research → dedupe → rank → select | ✅ done (Gemini verified live) |
| 2 | Per-platform copy generation | ✅ done |
| 3 | Media generation (Higgsfield Soul img + DoP video) | ✅ built (needs creds to verify) |
| 4 | Approval dashboard (review/edit/approve/schedule) | ✅ done |
| 5 | Scheduler + Telegram publisher (BullMQ) | ✅ built (needs token to verify) |
| 6 | Publisher registry: Telegram + Meta IG/FB; X/TikTok/YouTube stubbed | ✅ built |

### "Official look" / brand style

`src/generate/media/brandStyle.ts` is the single place that controls how official
news images and videos look. When you provide the official style spec (colors,
framing, lower-thirds, motion, logo, tone), we encode it there and every
generated asset inherits it. The prompt builder (`prompts.ts`) first asks Gemini
for a safe, representative **visual scene** (no real people), then wraps it in the
brand style.

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Start Postgres + Redis
docker compose up -d

# 3. Configure secrets
cp .env.example .env
#   - set GEMINI_API_KEY (https://aistudio.google.com/apikey)
#   - set HIGGSFIELD_API_KEY (later phases)
#   - set TELEGRAM_BOT_TOKEN + TELEGRAM_CHANNEL_ID (Phase 5)

# 4. Create the database schema
npm run db:push        # or: npm run db:migrate

# 5. Smoke-test the integrations
npx tsx src/scripts/test-gemini.ts        # research (works now)
npx tsx src/scripts/test-higgsfield.ts    # media (needs HIGGSFIELD_CREDENTIALS)

# 6a. Run the content pipeline once (research -> filter -> copy -> media)
npx tsx src/scripts/research-once.ts

# 6b. OR run the whole agent (dashboard + workers + scheduler)
npm run dev
#   open the approval console:  http://localhost:3000
```

## Running model

`npm run dev` (or `npm start` after `npm run build`) launches everything in one
process:

- **Approval dashboard** at `http://localhost:3000` — review each draft + its
  generated media, edit the copy/hashtags, then **Approve & schedule** or **Reject**.
- **Workers** (BullMQ): the `pipeline` job (research→filter→copy→media) runs on
  `RESEARCH_CRON`; the `scheduler` job scans every minute for approved posts whose
  time has come and publishes them.
- For scale, run `npm run worker` (workers only) on extra machines.

Flow: cron → research → ranked/selected → per-platform drafts → media generated →
**PENDING_APPROVAL** → you approve in the dashboard → **SCHEDULED** → scanner →
published at the chosen time.

## Publishing

Platform adapters live in `src/publish/` behind one `Publisher` interface:

| Platform | Status | Needs |
|----------|--------|-------|
| Telegram | ✅ implemented | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHANNEL_ID` |
| Instagram | ✅ implemented (Graph API) | `META_ACCESS_TOKEN`, `META_IG_BUSINESS_ID` + app review |
| Facebook | ✅ implemented (Graph API) | `META_ACCESS_TOKEN`, `META_FB_PAGE_ID` + app review |
| X / TikTok / YouTube | ⛔ registered, not configured | paid tier / content-API approval |

Set `ENABLED_PLATFORMS` to control which platforms drafts are generated for.

## Project layout

```
src/
├── config/        env validation (zod) + logger
├── db/            Prisma client
├── domain/        shared types + per-platform style/media profiles
├── queue/         Redis/BullMQ connection + queue names
├── research/      Gemini client + grounded news research
├── filter/        dedupe (content hash) + Gemini ranking
├── pipeline/      stage orchestration
├── scripts/       one-shot runners
├── main.ts        app entry (Phase 1 = run pipeline once)
└── worker.ts      queue workers (added in later phases)
prisma/
└── schema.prisma  data model
```

## Key dependency notes

- **Higgsfield** exposes a Bearer-token API (text-to-video, image-to-video,
  "Soul" image mode). It sits behind `MediaProvider` so a fallback (fal.ai /
  Replicate / Veo) can swap in.
- **Platform API approvals have long lead times.** Telegram works instantly;
  Instagram/Facebook need Meta app review; X requires a paid tier; TikTok/
  YouTube need content-posting API approval. Build order reflects this.
- Auto-posting news has **copyright/labeling** implications. Drafts carry source
  attribution and AI-generated visuals will be labeled as such.
```
