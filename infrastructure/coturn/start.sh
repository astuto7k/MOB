#!/bin/sh
set -eu
umask 077
: "${TURN_SECRET:?TURN_SECRET obrigatório}"
: "${TURN_PUBLIC_IP:?TURN_PUBLIC_IP obrigatório}"
: "${TURN_DOMAIN:?TURN_DOMAIN obrigatório}"
# Impede injeção de linhas na configuração.
case "$TURN_SECRET" in *[!a-zA-Z0-9_=-]*) echo 'TURN_SECRET deve ser hex/base64url, sem quebras de linha.' >&2; exit 1;; esac
case "$TURN_PUBLIC_IP" in *[!0-9.]*) echo 'TURN_PUBLIC_IP deve ser IPv4 público.' >&2; exit 1;; esac
case "$TURN_DOMAIN" in *[!a-zA-Z0-9.-]*) echo 'TURN_DOMAIN inválido.' >&2; exit 1;; esac
[ "${#TURN_SECRET}" -ge 32 ] || exit 1
cat /opt/arh/turnserver.conf > /tmp/turnserver.conf
printf '\nstatic-auth-secret=%s\nrealm=%s\nexternal-ip=%s\n' "$TURN_SECRET" "$TURN_DOMAIN" "$TURN_PUBLIC_IP" >> /tmp/turnserver.conf
if [ "${TURN_TLS_ENABLED:-0}" = 1 ]; then
  test -r /certs/fullchain.pem && test -r /certs/privkey.pem
  printf 'cert=/certs/fullchain.pem\npkey=/certs/privkey.pem\n' >> /tmp/turnserver.conf
else
  printf 'no-tls\n' >> /tmp/turnserver.conf
fi
exec turnserver -c /tmp/turnserver.conf
