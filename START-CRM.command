#!/bin/zsh
set -euo pipefail
cd "$(dirname "$0")"

echo "==> Starting Resoloon CRM"
echo

if ! docker info >/dev/null 2>&1; then
  echo "Docker is not running. Opening Docker Desktop…"
  open "/Applications/Docker.app/Contents/MacOS/Docker Desktop.app" 2>/dev/null \
    || open -a Docker 2>/dev/null \
    || open /Applications/Docker.app 2>/dev/null \
    || true
  echo "Waiting for Docker daemon…"
  for i in {1..90}; do
    if docker info >/dev/null 2>&1; then
      echo "Docker is up."
      break
    fi
    sleep 2
    if [[ $i -eq 90 ]]; then
      echo "Docker did not start. Fix Docker Desktop, then re-run this script."
      read -k 1 "?Press any key to close…"
      exit 1
    fi
  done
fi

echo "==> docker compose up"
docker compose up -d --build

echo "==> Waiting for API health…"
for i in {1..60}; do
  if curl -sf http://127.0.0.1:3000/health/live >/dev/null 2>&1; then
    echo "API is healthy."
    break
  fi
  sleep 2
done

echo "==> Ensuring developer admin exists (safe if already present)"
docker compose exec -T \
  -e ADMIN_NAME="Developer" \
  -e ADMIN_EMAIL="developer@resoloon.com" \
  app npm run bootstrap:admin 2>/dev/null || true

cat <<EOF

CRM should be at: http://localhost:3000
Login: developer@resoloon.com
Password: 111111111111

EOF

open "http://localhost:3000" 2>/dev/null || true
read -k 1 "?Press any key to close…"
