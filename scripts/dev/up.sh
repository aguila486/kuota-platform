#!/usr/bin/env bash
# Arranque local de Kuota Core (T030; US1; research R-18):
#   doctor → PostgreSQL (compose) sano → preflight de migraciones (solo lectura) → migraciones con kuota_migrator →
#   backend (pnpm --filter backend dev) →
#   espera de /health/ready.
# El backend queda en primer plano: Ctrl-C lo detiene (PostgreSQL sigue arriba; `scripts/dev/down.sh` lo detiene).
# Repetible: si PostgreSQL ya está arriba y las migraciones aplicadas, no cambia nada. Nunca crea ni sobrescribe .env y
# nunca borra volúmenes.
#
# Variables opcionales: KUOTA_ENV_FILE (por defecto .env), KUOTA_COMPOSE_PROJECT (por defecto kuota),
# KUOTA_READY_TIMEOUT (segundos, por defecto 120).
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

KUOTA_ENV_FILE="${KUOTA_ENV_FILE:-$KUOTA_ROOT/.env}"
KUOTA_COMPOSE_PROJECT="${KUOTA_COMPOSE_PROJECT:-kuota}"
READY_TIMEOUT="${KUOTA_READY_TIMEOUT:-120}"
PID_FILE="$KUOTA_STATE_DIR/backend-$KUOTA_COMPOSE_PROJECT.pid"

[ -f "$KUOTA_ENV_FILE" ] || die "No existe $KUOTA_ENV_FILE." \
  "Créalo desde la plantilla (valores ficticios): cp .env.example .env"

step "Verificación del entorno (doctor)"
"$KUOTA_ROOT/scripts/dev/doctor.sh" || die "El entorno no cumple los requisitos (ver arriba)."

load_env_file "$KUOTA_ENV_FILE"
PG_PORT="${KUOTA_PG_HOST_PORT:-55432}"
API_PORT="${PORT:-3000}"
for var in DATABASE_URL_APP DATABASE_URL_MIGRATOR; do
  [ -n "${!var:-}" ] || die "Falta $var en $KUOTA_ENV_FILE." "Compárala con .env.example."
done

step "Puertos"
if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  die "El backend ya está corriendo (pid $(cat "$PID_FILE"))." "Detenlo con Ctrl-C en su terminal o con: make down"
fi
rm -f "$PID_FILE"
if port_in_use "$API_PORT"; then
  die "El puerto de la API $API_PORT (PORT) está ocupado por otro proceso." \
    "Libéralo (lsof -nP -iTCP:$API_PORT -sTCP:LISTEN) o cambia PORT en $KUOTA_ENV_FILE."
fi
if [ -z "$(kuota_compose ps --status running -q postgres 2>/dev/null)" ] && port_in_use "$PG_PORT"; then
  die "El puerto $PG_PORT (KUOTA_PG_HOST_PORT) está ocupado por otro proceso, no por el PostgreSQL de Kuota." \
    "Libéralo o cambia KUOTA_PG_HOST_PORT (y el puerto de las URL DATABASE_URL_*) en $KUOTA_ENV_FILE."
fi
note "API: $API_PORT · PostgreSQL: 127.0.0.1:$PG_PORT"

step "PostgreSQL (docker compose, proyecto $KUOTA_COMPOSE_PROJECT)"
kuota_compose up -d --wait --wait-timeout 120 postgres ||
  die "PostgreSQL no quedó sano." "Revisa: docker compose -p $KUOTA_COMPOSE_PROJECT -f infra/docker/compose.yaml logs postgres"

step "Prerrequisitos de migración (preflight de solo lectura)"
# Antes de migrar: una migración fallida bloquea las siguientes y no se resuelve sin un procedimiento aprobado. El
# preflight no aprovisiona nada ni imprime credenciales; si falla, no se intenta ninguna migración.
(cd "$KUOTA_ROOT/backend" && node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/migration-preflight.ts) ||
  die "Faltan prerrequisitos de plataforma para migrar (ver arriba): no se aplicó ninguna migración." \
    "Ejecuta la acción administrativa indicada (con revisión) y vuelve a lanzar make up." \
    "Nunca uses migrate resolve, migrate dev, db push ni migrate reset para sortearlo."

step "Migraciones (prisma migrate deploy con kuota_migrator)"
(cd "$KUOTA_ROOT/backend" && pnpm exec prisma migrate deploy) ||
  die "La migración falló; el backend no se arranca." \
    "Cada migración es atómica (BEGIN/COMMIT, condición P1): la que falló no dejó cambios parciales." \
    "Corrige la causa (salida de arriba) y sigue el procedimiento de docs/architecture/data-architecture.md §8." \
    "No uses migrate dev, db push ni migrate reset."

step "Backend (pnpm --filter backend dev)"
mkdir -p "$KUOTA_STATE_DIR"
# La API nunca recibe la credencial de migración ni las contraseñas del contenedor (FR-014).
(cd "$KUOTA_ROOT" && exec env -u DATABASE_URL_MIGRATOR -u POSTGRES_PASSWORD -u KUOTA_MIGRATOR_PASSWORD \
  -u KUOTA_APP_LOGIN_PASSWORD pnpm --filter backend run dev) &
BACKEND_PID=$!
echo "$BACKEND_PID" > "$PID_FILE"

stop_backend() {
  if kill -0 "$BACKEND_PID" 2>/dev/null; then
    note "Deteniendo el backend…"
    kill_tree "$BACKEND_PID"
    wait "$BACKEND_PID" 2>/dev/null || true
  fi
  rm -f "$PID_FILE"
}
trap stop_backend EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

step "Esperando /health/ready (máx. ${READY_TIMEOUT}s)"
deadline=$((SECONDS + READY_TIMEOUT))
until [ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$API_PORT/health/ready" || true)" = "200" ]; do
  kill -0 "$BACKEND_PID" 2>/dev/null || die "El backend terminó durante el arranque (ver logs arriba)."
  [ "$SECONDS" -lt "$deadline" ] || die "/health/ready no respondió 200 en ${READY_TIMEOUT}s (ver logs arriba)." \
    "Comprueba DATABASE_URL_APP en $KUOTA_ENV_FILE y: curl -s http://127.0.0.1:$API_PORT/health/ready"
  sleep 1
done

cat <<MSG

✓ Kuota Core listo
    curl -s http://127.0.0.1:$API_PORT/health/live
    curl -s http://127.0.0.1:$API_PORT/health/ready
    curl -s http://127.0.0.1:$API_PORT/v1/meta/compatibility
  Ctrl-C detiene el backend; make down detiene también PostgreSQL (los datos se conservan).
MSG
wait "$BACKEND_PID"
