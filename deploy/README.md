# ReportageGO Hetzner Deployment

This v1 deployment is intentionally one monorepo, one pipeline, one Compose
stack.

## Server Files

Create `/opt/reportajgo` on the server and place:

- `.env` based on `deploy/compose.env.example`
- `backend.env` based on `deploy/backend.env.example`
- `frontend.env` based on `deploy/frontend.env.example`
- `bot.env` based on `deploy/bot.env.example`

The GitHub Actions deploy job uploads `docker-compose.production.yml` and
`Caddyfile` on every deploy, then renames the compose file to
`/opt/reportajgo/docker-compose.yml`.

If the GitHub secrets `VPS_HOST`, `VPS_USER`, or `VPS_SSH_KEY` are missing, the
workflow still verifies/builds/pushes images but skips the SSH deploy step.

Do not commit real env files.

## First Server Bootstrap

```bash
ssh -i ~/.ssh/key.pem root@62.238.53.186
bash /opt/reportajgo/bootstrap-hetzner.sh
```

If the script is not on the server yet, copy `deploy/bootstrap-hetzner.sh` there
first.

## Deploy

GitHub Actions builds:

- `ghcr.io/reportajgo/reportajgo-backend`
- `ghcr.io/reportajgo/reportajgo-frontend`

The deploy job then runs:

```bash
cd /opt/reportajgo
mv -f docker-compose.production.yml docker-compose.yml
docker compose pull
docker compose up -d --remove-orphans
```

## One-shot configuration (`apply-prod.sh`)

After the GitHub deploy has built the image and uploaded the compose, configure
all the agent features in one idempotent step. Run it **from your dev machine at
the repo root** (it needs your SSH key and the local `.secrets/*.json` files):

```bash
bash deploy/apply-prod.sh                        # Higgsfield + S3 + Website + Instagram
DO_INSTAGRAM=0 bash deploy/apply-prod.sh         # skip a section
ASSUME_YES=1 RUN_AFTER=1 bash deploy/apply-prod.sh   # no prompt, trigger a run after
```

It uploads the Higgsfield token + Instagram session into `.secrets/`, sets the
matching `backend.env` values (reusing the frontend's S3 bucket + agent key),
recreates the affected containers, and verifies the result. Safe to re-run.

## Article covers (generated media)

Generated images live on the `media_data` volume, shared by `backend-app`,
`backend-worker` and `telegram-bot`: the worker and the bot write them, and
`backend-app` serves them at `/media`, which Caddy publishes as
`https://<DOMAIN>/agent/media/<file>`. `PUBLIC_BASE_URL` is set to
`https://<DOMAIN>/agent` in the compose file so every minted media URL is that
public address.

That matters because the site does not link the agent's image — it **fetches**
it and re-hosts it under `/uploads`. A URL only the agent's own container can
reach (`http://localhost:3010/media/…`, the old default) cannot be fetched or
displayed, which is what left articles with broken covers. Re-hosted uploads
live on the `frontend_uploads` volume so a redeploy no longer wipes them.

To repair articles that were ingested with an unusable cover:

```bash
docker compose exec frontend node scripts/rehost-images.mjs   # DRY_RUN=1 to preview
```

It re-points each broken cover at the public agent origin and re-hosts it; when
the image is genuinely gone the cover is cleared, so the article falls back to
the branded gradient tile instead of a broken image.

## Smoke Checks

```bash
docker compose ps
docker compose logs --tail=100 backend-app
docker compose logs --tail=100 frontend
docker compose logs --tail=100 telegram-bot
curl -I https://reportajgo.uz
```
