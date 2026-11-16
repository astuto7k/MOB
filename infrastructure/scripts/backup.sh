#!/usr/bin/env bash
set -euo pipefail
umask 077
cd "$(dirname "$0")/../.."
command -v age >/dev/null
recipient="$(node --input-type=module -e 'import fs from "node:fs"; import {parse} from "dotenv"; const e=parse(fs.readFileSync(".env")); if(!e.BACKUP_AGE_RECIPIENT?.startsWith("age1")) process.exit(1); process.stdout.write(e.BACKUP_AGE_RECIPIENT);')"
retention="$(node --input-type=module -e 'import fs from "node:fs"; import {parse} from "dotenv"; const n=Number(parse(fs.readFileSync(".env")).BACKUP_RETENTION_DAYS||14); if(!Number.isInteger(n)||n<1||n>365) process.exit(1); process.stdout.write(String(n));')"
mkdir -p backups
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
target="backups/arh-${stamp}.dump.age"
trap 'rm -f "${target}.partial"' EXIT
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' | age -r "$recipient" > "${target}.partial"
test -s "${target}.partial"
mv "${target}.partial" "$target"
find backups -name 'arh-*.dump.age' -type f -mtime "+$retention" -delete
printf 'Backup criptografado criado: %s\n' "$target"
