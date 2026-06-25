# ReportajGO — AI Agent API

Machine-to-machine API for the news agent. The agent finds & filters news,
submits it here, a human approves it in Telegram (or the admin panel), then the
article goes live on the site and the agent is notified so it can cross-post.

```
agent → POST /api/agent/posts (PENDING) → Telegram ✅/❌
   approved → status=PUBLISHED → live on site
            → callback to agent  AND/OR  agent polls GET /api/agent/posts?status=PUBLISHED&since=…
            → agent publishes to other channels
```

## Auth
Send the API key on every request:
```
Authorization: Bearer <AGENT_API_KEY>
```
Key lives in `.env` as `AGENT_API_KEY`.

## Submit a news item
`POST /api/agent/posts`
```json
{
  "title": "Headline",
  "excerpt": "One-sentence summary",
  "content": "Full body.\n\nUse blank lines between paragraphs.",
  "category": "world",          // world | economics | sport | culture | tech
  "language": "ru",             // uz | ru | en  (= site version it appears on)
  "imageUrl": "https://…/x.jpg",// optional, remote URL
  "source": "Reuters",          // optional
  "sourceUrl": "https://…",     // optional, original article
  "breaking": false,            // optional
  "dedupeKey": "sha1-of-url"    // optional but recommended — prevents duplicates
}
```
- `201 { duplicate:false, post }` — created as **PENDING**, Telegram card sent.
- `200 { duplicate:true, post }` — `dedupeKey` already ingested (idempotent retry).
- `400` invalid body / category / language · `401|403` bad key.

## Pull posts (e.g. newly approved, to cross-post)
`GET /api/agent/posts?status=PUBLISHED&language=ru&since=<ISO>&limit=50`
```json
{ "count": 1, "posts": [ { "id","title","excerpt","body","language",
  "category","status","imageUrl","source","sourceUrl","breaking",
  "approvedAt","createdAt","url" } ] }
```
For `status=PUBLISHED`, `since` filters on `approvedAt` and results are sorted by
`approvedAt desc` — so the agent can sync "everything approved since last time".

## Approval callback (optional, push instead of poll)
Set in `.env`:
```
AGENT_CALLBACK_URL="https://your-agent/webhook"
AGENT_CALLBACK_SECRET="shared-secret"
```
On approve/reject the site POSTs:
```json
{ "event": "post.approved",     // or "post.rejected"
  "post": { "id","title","excerpt","language","category","status",
            "sourceUrl","imageUrl","approvedAt","url" } }
```
Header `X-Callback-Secret` carries the secret for verification. Best-effort: a
failed callback never blocks moderation (use the poll endpoint as backstop).

## Moderation
- New agent posts are **PENDING** and hidden from the public site.
- Approve/reject via the Telegram bot (`✅/❌`) or the admin panel buttons.
- Approval sets `status=PUBLISHED` + `approvedAt`, and the article appears at
  `/{language}/article/{id}`.
