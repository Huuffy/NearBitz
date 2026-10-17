#!/usr/bin/env bash
# GeoSales.ai - one-command start for macOS and Linux (Windows: start.cmd / scripts/start.ps1).
#
#   ./scripts/start.sh             start everything (frontend is always restarted)
#   ./scripts/start.sh --clear     also clear the Metro bundler cache
#   ./scripts/start.sh --no-photon skip Photon (only needed to geocode new companies)
#
# Order: Docker -> Postgres + API (docker compose) -> Photon -> Expo web (runs in this terminal).
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="$ROOT/.run"
PHOTON_DIR="$ROOT/geocoder/photon_v1"
EXPO_PORT=8081
CLEAR=""
NO_PHOTON=0
for arg in "$@"; do
  case "$arg" in
    --clear) CLEAR="--clear" ;;
    --no-photon) NO_PHOTON=1 ;;
    *) echo "unknown option: $arg"; exit 2 ;;
  esac
done
mkdir -p "$RUN_DIR"

step() { printf '\n\033[36m==> %s\033[0m\n' "$1"; }
ok()   { printf '    \033[32m%s\033[0m\n' "$1"; }
warn() { printf '    \033[33m%s\033[0m\n' "$1"; }
fail() { printf '    \033[31m%s\033[0m\n' "$1"; exit 1; }

url_up() { curl -fsS --max-time 4 -o /dev/null "$1" 2>/dev/null; }

wait_until() {  # wait_until <seconds> <command...>
  local deadline=$(( $(date +%s) + $1 )); shift
  until "$@"; do
    [ "$(date +%s)" -ge "$deadline" ] && { echo; return 1; }
    printf '.'; sleep 2
  done
  return 0
}

stop_port() {
  local pids
  pids="$(lsof -ti tcp:"$1" -sTCP:LISTEN 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    kill $pids 2>/dev/null; sleep 1; kill -9 $pids 2>/dev/null || true
    ok "stopped process(es) $pids on port $1"
  fi
}

# 1. Docker -----------------------------------------------------------------
step "Docker"
command -v docker >/dev/null || fail "docker not found - install Docker Desktop (macOS) or Docker Engine (Linux)."
if ! docker info >/dev/null 2>&1; then
  if [ "$(uname)" = "Darwin" ]; then
    warn "Docker Desktop is not running - starting it"
    open -a Docker
  else
    warn "Docker daemon is not running - trying: sudo systemctl start docker"
    sudo systemctl start docker || true
  fi
  wait_until 180 docker info >/dev/null 2>&1 || fail "Docker did not become ready within 3 minutes."
fi
ok "Docker engine is ready"

# 2. Postgres + API -----------------------------------------------------------
step "Database and API (docker compose)"
(cd "$ROOT" && docker compose up -d) || fail "docker compose up failed."
wait_until 120 url_up http://localhost:3000/health || fail "API did not answer - check: docker logs geosales_api"
ok "API is up at http://localhost:3000"

# 3. Photon -------------------------------------------------------------------
if [ "$NO_PHOTON" -eq 1 ]; then
  step "Photon (skipped)"
else
  step "Photon geocoder"
  if url_up "http://localhost:2322/api?q=mumbai&limit=1"; then
    ok "already running on port 2322"
  elif ! command -v java >/dev/null; then
    warn "java not found - Photon not started (map still works; geocoding new companies will not)."
  elif ! ls "$PHOTON_DIR"/photon-*.jar >/dev/null 2>&1 || [ ! -d "$PHOTON_DIR/photon_data" ]; then
    warn "Photon jar or photon_data missing in $PHOTON_DIR - see geocoder/README.md"
  else
    stop_port 2322
    JAR="$(basename "$(ls "$PHOTON_DIR"/photon-*.jar | head -1)")"
    (cd "$PHOTON_DIR" && nohup java -Xmx3G -jar "$JAR" serve -listen-ip 0.0.0.0 -listen-port 2322 \
        > "$RUN_DIR/photon.log" 2>&1 & echo $! > "$RUN_DIR/photon.pid")
    if wait_until 120 url_up "http://localhost:2322/api?q=mumbai&limit=1"; then
      ok "started (pid $(cat "$RUN_DIR/photon.pid")), log in .run/photon.log"
    else
      warn "Photon did not answer within 2 minutes - see .run/photon.log"
    fi
  fi
fi

# 4. Frontend (always restarted, runs in the foreground) ----------------------
step "Frontend (Expo web)"
for port in $EXPO_PORT 19000 19001 19006; do stop_port "$port"; done
wait_until 20 bash -c "! lsof -ti tcp:$EXPO_PORT -sTCP:LISTEN >/dev/null 2>&1" || fail "Port $EXPO_PORT is still in use."

step "Ready"
echo "    App       http://localhost:$EXPO_PORT"
echo "    API       http://localhost:3000/health"
[ "$NO_PHOTON" -eq 0 ] && echo "    Photon    http://localhost:2322"
echo "    Press Ctrl+C to stop the frontend (Docker and Photon keep running)."
cd "$ROOT/mobile" && exec npx expo start --web $CLEAR
