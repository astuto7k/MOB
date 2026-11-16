#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
command -v docker >/dev/null
node infrastructure/scripts/check-env.mjs --production
docker compose config --quiet
docker compose build --pull
docker compose up -d postgres
docker compose run --rm api npm run db:migrate -w @arh/api
docker compose up -d --wait --wait-timeout 180
docker compose ps
printf '%s\n' 'Serviços iniciados. Provisione o proprietário via bootstrap (README) e teste um Android físico.'
