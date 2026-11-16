#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
if [ "$#" != 3 ] || [ "$3" != '--replace-database' ]; then
  printf '%s\n' 'Uso: restore.sh /caminho/backup.dump.age /caminho/chave-age --replace-database' >&2
  exit 2
fi
test -r "$1" && test -r "$2"
command -v age >/dev/null
# Os consumidores param antes da restauração, para impedir conexões com estado antigo.
docker compose stop api web
age -d -i "$2" "$1" | docker compose exec -T postgres sh -c 'pg_restore --clean --if-exists --no-owner -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
docker compose run --rm api npm run db:migrate -w @arh/api
docker compose exec -T postgres sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
BEGIN;
UPDATE admin_sessions SET revoked_at = CURRENT_TIMESTAMP;
UPDATE device_credentials SET revoked_at = CURRENT_TIMESTAMP;
UPDATE devices SET revoked_at = CURRENT_TIMESTAMP;
UPDATE pairing_requests SET revoked_at = CURRENT_TIMESTAMP;
UPDATE remote_sessions SET status = 'ENDED', control_approved = false, ended_at = CURRENT_TIMESTAMP, end_reason = 'BACKUP_RESTORED';
UPDATE session_permissions SET revoked_at = CURRENT_TIMESTAMP;
UPDATE users SET locked_until = '9999-01-01T00:00:00Z', recovery_hashes = '{}';
COMMIT;
SQL
# Sessões anteriores nunca são reativadas pelo restore; API invalida estados em seu startup.
docker compose up -d api web
printf '%s\n' 'Banco restaurado com acessos invalidados. Execute owner:reset localmente, ative MFA e pareie novamente os aparelhos (DEPLOYMENT.md).'
