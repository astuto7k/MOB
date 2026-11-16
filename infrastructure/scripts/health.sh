#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
docker compose ps
docker compose exec -T api node -e "fetch('http://127.0.0.1:3001/api/v1/health').then(async r=>{console.log(await r.text());process.exit(r.ok?0:1)}).catch(()=>process.exit(1))"
docker compose exec -T postgres sh -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
printf '%s\n' 'TURN: este check confirma apenas processo; teste um candidato relay real no navegador.'
