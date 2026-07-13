# ReportajGO Hetzner Deployment

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

## Smoke Checks

```bash
docker compose ps
docker compose logs --tail=100 backend-app
docker compose logs --tail=100 frontend
docker compose logs --tail=100 telegram-bot
curl -I https://reportajgo.uz
```
