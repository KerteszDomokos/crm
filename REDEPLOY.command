#!/bin/zsh
cd "$(dirname "$0")"
set -euo pipefail
echo "Rebuilding Resoloon CRM Docker app (db stays)…"
npm run build
docker compose up -d --build app
echo
echo "Ready → http://localhost:3000"
open "http://localhost:3000" 2>/dev/null || true
