#!/usr/bin/env bash
# Detiene el entorno local (T030): el backend arrancado por up.sh y el PostgreSQL de compose. Conserva el volumen de
# datos (usa `stop`; nunca `down -v`). Repetible: si no hay nada corriendo, no falla.
# Variables opcionales: KUOTA_ENV_FILE (por defecto .env), KUOTA_COMPOSE_PROJECT (por defecto kuota).
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

KUOTA_ENV_FILE="${KUOTA_ENV_FILE:-$KUOTA_ROOT/.env}"
KUOTA_COMPOSE_PROJECT="${KUOTA_COMPOSE_PROJECT:-kuota}"
PID_FILE="$KUOTA_STATE_DIR/backend-$KUOTA_COMPOSE_PROJECT.pid"

step "Backend"
if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  pid="$(cat "$PID_FILE")"
  kill_tree "$pid"
  for _ in $(seq 1 30); do kill -0 "$pid" 2>/dev/null || break; sleep 0.5; done
  if kill -0 "$pid" 2>/dev/null; then die "El backend (pid $pid) no terminó; revisa el proceso manualmente."; fi
  note "detenido (pid $pid)"
else
  note "no estaba corriendo"
fi
rm -f "$PID_FILE"

step "PostgreSQL (proyecto $KUOTA_COMPOSE_PROJECT)"
[ -f "$KUOTA_ENV_FILE" ] || die "No existe $KUOTA_ENV_FILE: no se puede identificar el entorno de compose."
kuota_compose stop postgres
note "detenido; el volumen de datos se conserva"
