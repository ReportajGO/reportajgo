#!/usr/bin/env bash
#
# deploy/apply-prod.sh — one-shot, idempotent production configuration.
#
# Run it FROM YOUR DEV MACHINE at the repo root. It needs your SSH key and the
# local secret files this machine produced:
#   .secrets/higgsfield-oauth.prod.json   (npm run higgsfield:login)
#   .secrets/instagram-state.json         (npm run instagram:login)
#
# It configures, on the Hetzner server, then recreates the affected containers
# and verifies the result:
#   • Higgsfield image generation  — copies the OAuth token into the worker
#   • S3 media storage             — reuses the frontend's bucket + keys
#   • Website cross-posting        — enables WEBSITE, syncs the shared API key
#   • Instagram "web" publishing   — ships the logged-in session, enables INSTAGRAM
#
# Prereq: the GitHub Actions deploy for the latest commit must have finished — it
# builds the browser-capable image and uploads the updated docker-compose.
#
# Usage:
#   bash deploy/apply-prod.sh                         # everything, with a confirm
#   DO_INSTAGRAM=0 bash deploy/apply-prod.sh          # skip a section
#   ASSUME_YES=1 RUN_AFTER=1 bash deploy/apply-prod.sh
#   SSH_KEY=~/.ssh/hetzner.pem bash deploy/apply-prod.sh
#
set -euo pipefail

# ─── configuration (override via environment) ────────────────────────────────
SSH_KEY="${SSH_KEY:-$HOME/.ssh/key.pem}"
SERVER="${SERVER:-root@62.238.53.186}"
REMOTE_DIR="${REMOTE_DIR:-/opt/reportajgo}"

DO_HIGGSFIELD="${DO_HIGGSFIELD:-1}"
DO_S3="${DO_S3:-1}"
DO_WEBSITE="${DO_WEBSITE:-1}"
DO_INSTAGRAM="${DO_INSTAGRAM:-1}"
RUN_AFTER="${RUN_AFTER:-0}"        # trigger a pipeline run at the end
ASSUME_YES="${ASSUME_YES:-0}"

HF_TOKEN_LOCAL="${HF_TOKEN_LOCAL:-.secrets/higgsfield-oauth.prod.json}"
IG_STATE_LOCAL="${IG_STATE_LOCAL:-.secrets/instagram-state.json}"

# ─── pretty output ───────────────────────────────────────────────────────────
if [ -t 1 ]; then B=$'\e[1m'; G=$'\e[32m'; Y=$'\e[33m'; R=$'\e[31m'; C=$'\e[36m'; Z=$'\e[0m'; else B=; G=; Y=; R=; C=; Z=; fi
info(){ printf '%s»%s %s\n' "$C" "$Z" "$*"; }
ok(){   printf '%s✓%s %s\n' "$G" "$Z" "$*"; }
warn(){ printf '%s!%s %s\n' "$Y" "$Z" "$*"; }
die(){  printf '%s✗ %s%s\n' "$R" "$*" "$Z" >&2; exit 1; }
hr(){   printf '%s──────────────────────────────────────────────────────────%s\n' "$B" "$Z"; }

SSH=(ssh -i "$SSH_KEY" -o ConnectTimeout=12 "$SERVER")
put(){ scp -q -i "$SSH_KEY" -o ConnectTimeout=12 "$1" "$SERVER:$2"; }

# ─── preflight ───────────────────────────────────────────────────────────────
hr; info "ReportajGO prod deploy → ${B}${SERVER}${Z}:${REMOTE_DIR}"; hr
[ -f "$SSH_KEY" ] || die "SSH key not found: $SSH_KEY   (set SSH_KEY=/path/to/key)"
[ "$DO_HIGGSFIELD" = 1 ] && { [ -f "$HF_TOKEN_LOCAL" ] || die "missing $HF_TOKEN_LOCAL — run: npm run higgsfield:login"; }
[ "$DO_INSTAGRAM" = 1 ]  && { [ -f "$IG_STATE_LOCAL" ]  || die "missing $IG_STATE_LOCAL — run: npm run instagram:login"; }

info "checking SSH + server layout…"
"${SSH[@]}" "test -d '$REMOTE_DIR'"                 || die "cannot reach $SERVER or $REMOTE_DIR is missing"
"${SSH[@]}" "test -f '$REMOTE_DIR/backend.env'"     || die "$REMOTE_DIR/backend.env missing on server"
"${SSH[@]}" "test -f '$REMOTE_DIR/docker-compose.yml'" || die "$REMOTE_DIR/docker-compose.yml missing — run the GitHub deploy first"
ok "server reachable; compose + env present"

echo
printf '  Higgsfield token : %s\n' "$([ "$DO_HIGGSFIELD" = 1 ] && echo apply || echo skip)"
printf '  S3 media storage : %s\n' "$([ "$DO_S3" = 1 ] && echo apply || echo skip)"
printf '  Website posting  : %s\n' "$([ "$DO_WEBSITE" = 1 ] && echo apply || echo skip)"
printf '  Instagram (web)  : %s\n' "$([ "$DO_INSTAGRAM" = 1 ] && echo apply || echo skip)"
printf '  Pipeline run     : %s\n' "$([ "$RUN_AFTER" = 1 ] && echo yes || echo no)"
echo
if [ "$ASSUME_YES" != 1 ]; then
  read -r -p "Apply to PRODUCTION now? [y/N] " a
  case "$a" in y|Y) ;; *) die "aborted" ;; esac
fi

# ─── upload secret files ─────────────────────────────────────────────────────
"${SSH[@]}" "mkdir -p '$REMOTE_DIR/.secrets' '$REMOTE_DIR/.instagram-profile'"
if [ "$DO_HIGGSFIELD" = 1 ]; then info "uploading Higgsfield token…"; put "$HF_TOKEN_LOCAL" "$REMOTE_DIR/.secrets/higgsfield-oauth.json"; ok "token uploaded"; fi
if [ "$DO_INSTAGRAM" = 1 ];  then info "uploading Instagram session…"; put "$IG_STATE_LOCAL"  "$REMOTE_DIR/.secrets/instagram-state.json"; ok "session uploaded"; fi

# ─── remote configuration + recreate ─────────────────────────────────────────
info "applying backend.env + recreating containers…"
"${SSH[@]}" "DO_HIGGSFIELD='$DO_HIGGSFIELD' DO_S3='$DO_S3' DO_WEBSITE='$DO_WEBSITE' DO_INSTAGRAM='$DO_INSTAGRAM' RUN_AFTER='$RUN_AFTER' REMOTE_DIR='$REMOTE_DIR' bash -s" <<'REMOTE'
set -euo pipefail
cd "$REMOTE_DIR"
ts="$(date +%Y%m%d-%H%M%S)"
cp backend.env "backend.env.$ts.bak"
echo "  backup: backend.env.$ts.bak"

# Robust upsert: delete any existing line, then append (survives any value —
# S3 secret keys, URLs, '&', '/', spaces — that would break naive sed replace).
up(){ sed -i "/^$2=/d" "$1"; printf '%s=%s\n' "$2" "$3" >> "$1"; }
upsert(){ up backend.env "$1" "$2"; }
frontval(){ grep "^$1=" frontend.env 2>/dev/null | head -1 | cut -d= -f2- || true; }
enable_platform(){
  if ! grep -q '^ENABLED_PLATFORMS=' backend.env; then echo "ENABLED_PLATFORMS=TELEGRAM,$1" >> backend.env; return; fi
  grep -Eq "^ENABLED_PLATFORMS=.*(^|,| )$1(,| |$)" backend.env || sed -i "s|^ENABLED_PLATFORMS=.*|&,$1|" backend.env
}

RECREATE="backend-worker"

if [ "$DO_HIGGSFIELD" = 1 ]; then
  upsert MEDIA_GENERATION_ENABLED true
  upsert IMAGE_PROVIDER higgsfield-mcp
  upsert HIGGSFIELD_IMAGE_MODEL nano_banana_pro
  upsert BRAND_CARD_ENABLED true
  upsert BRAND_CARD_RATIO 1:1
  upsert CARD_RENDERER template
  # Mounted-file auth rotates + persists; clear any stale env-var creds so it wins.
  sed -i '/^HIGGSFIELD_CLIENT_ID=/d; /^HIGGSFIELD_REFRESH_TOKEN=/d' backend.env
  echo "  higgsfield: image generation configured"
fi

if [ "$DO_S3" = 1 ]; then
  upsert MEDIA_STORAGE_DRIVER s3
  for V in AWS_REGION AWS_S3_BUCKET AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_S3_ENDPOINT AWS_S3_FORCE_PATH_STYLE AWS_S3_PUBLIC_BASE_URL; do
    upsert "$V" "$(frontval "$V")"
  done
  upsert AWS_S3_KEY_PREFIX media
  [ -n "$(frontval AWS_S3_BUCKET)" ] || echo "  ! frontend.env AWS_S3_BUCKET is empty — fill the S3 creds or website/IG images won't be public"
  echo "  s3: media storage set (reusing the frontend bucket, prefix=media)"
fi

if [ "$DO_WEBSITE" = 1 ]; then
  KEY="$(frontval AGENT_API_KEY)"
  if [ -z "$KEY" ]; then
    KEY="$(openssl rand -hex 32 2>/dev/null || tr -dc 'a-f0-9' </dev/urandom | head -c64)"
    up frontend.env AGENT_API_KEY "$KEY"
    RECREATE="$RECREATE frontend"
    echo "  website: generated a shared AGENT_API_KEY and set it on the frontend"
  fi
  upsert WEBSITE_API_KEY "$KEY"
  enable_platform WEBSITE
  echo "  website: enabled + ingest key synced"
fi

if [ "$DO_INSTAGRAM" = 1 ]; then
  upsert INSTAGRAM_PUBLISHER web
  upsert INSTAGRAM_HEADLESS false
  upsert INSTAGRAM_BROWSER_CHANNEL ""     # empty → bundled Chromium (matches login + container)
  enable_platform INSTAGRAM
  grep -q 'instagram-profile:/app/.instagram-profile' docker-compose.yml \
    || echo "  ! compose has no .instagram-profile mount yet — run the GitHub deploy (browser image) first"
  echo "  instagram: web publisher enabled"
fi

echo "  pulling + recreating: $RECREATE"
docker compose pull $RECREATE
docker compose up -d --force-recreate $RECREATE

if [ "$RUN_AFTER" = 1 ]; then
  U="$(grep '^DASHBOARD_USERNAME=' backend.env | head -1 | cut -d= -f2-)"
  P="$(grep '^DASHBOARD_PASSWORD=' backend.env | head -1 | cut -d= -f2-)"
  echo "  triggering a pipeline run…"
  if curl -fsS -u "$U:$P" -H 'X-Requested-With: XMLHttpRequest' -X POST http://127.0.0.1:3010/api/pipeline/run >/dev/null 2>&1; then
    echo "  pipeline run queued"
  else
    echo "  (couldn't trigger — start a run from the Telegram admin instead)"
  fi
fi
REMOTE
ok "config applied + containers recreated"

# ─── verify ──────────────────────────────────────────────────────────────────
hr; info "verifying (give the worker a few seconds to boot)…"
"${SSH[@]}" "REMOTE_DIR='$REMOTE_DIR' bash -s" <<'REMOTE'
set -uo pipefail
cd "$REMOTE_DIR"
sleep 6
echo "— mounted secrets/profile inside the worker —"
docker compose exec -T backend-worker sh -lc 'ls -l /app/.secrets/ 2>/dev/null; ls -ld /app/.instagram-profile 2>/dev/null' \
  || echo "  (worker still starting — check logs below)"
echo "— services —"
docker compose ps
echo "— recent worker logs —"
docker compose logs --tail=25 backend-worker
REMOTE

hr
ok "Done."
echo "Next: after a pipeline run, watch for these in the worker logs —"
echo "    ${G}branded card composited${Z}          image generation OK"
echo "    ${G}published to website${Z}             website cross-post OK"
echo "    ${G}seeded Instagram session…${Z} then ${G}posted to instagram (web)${Z}   Instagram OK"
echo "Live tail:  ssh -i $SSH_KEY $SERVER 'cd $REMOTE_DIR && docker compose logs -f backend-worker'"
