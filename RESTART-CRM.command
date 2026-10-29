#!/bin/zsh
cd "$(dirname "$0")"
set -euo pipefail

echo "Stopping stray CRM Node servers (keeping Postgres/Docker DB)…"

# Kill local node listeners on 3001–3010 and Vite
for port in {3001..3010} 5173; do
  pids=$(lsof -tiTCP:$port -sTCP:LISTEN 2>/dev/null || true)
  if [[ -n "${pids:-}" ]]; then
    echo "  killing :$port -> $pids"
    echo "$pids" | xargs kill -9 2>/dev/null || true
  fi
done

# Also kill any leftover api/vite by command line
pkill -f 'apps/api/dist/server.js' 2>/dev/null || true
pkill -f 'vite' 2>/dev/null || true

# If Docker is available: stop only the app container, leave db running
if docker compose ps >/dev/null 2>&1; then
  echo "Stopping Docker app service (db stays up)…"
  docker compose stop app 2>/dev/null || true
fi

sleep 0.8
echo
echo "Ports after cleanup:"
lsof -nP -iTCP:3000-3010 -sTCP:LISTEN 2>/dev/null || echo "  (none on 3000-3010)"
lsof -nP -iTCP:5173 -sTCP:LISTEN 2>/dev/null || echo "  (none on 5173)"
echo

echo "Building latest web + api…"
npm run build

# Prefer :3000 if free; otherwise free it from leftover node only (not docker db)
if lsof -tiTCP:3000 -sTCP:LISTEN >/dev/null 2>&1; then
  # If it's our old node, kill it. If it's docker app, try stop again.
  if docker compose stop app >/dev/null 2>&1; then
    sleep 0.5
  fi
fi

if lsof -tiTCP:3000 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port 3000 still busy — starting on 3000 failed. Showing holder:"
  lsof -nP -iTCP:3000 -sTCP:LISTEN || true
  echo "Try: docker compose stop app"
  exit 1
fi

export DATABASE_URL="${DATABASE_URL:-postgres://resoloon:local-development-only@localhost:5432/resoloon}"
export HOST=127.0.0.1
export PORT=3000
export PUBLIC_ORIGIN=http://localhost:3000
export COOKIE_SECURE=false

echo
echo "Starting Resoloon CRM on http://localhost:3000"
echo "Login: developer@resoloon.com / 111111111111"
echo "(Ctrl+C to stop)"
echo
open "http://localhost:3000" 2>/dev/null || true
exec node apps/api/dist/server.js
