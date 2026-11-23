#!/usr/bin/env bash
# Gate de PostgreSQL 18 efímero (G12; T048: db:check-rls; ADR-0004 P1–P4; 0002). Reproduce el flujo operativo real,
# no una simulación: aprovisionamiento de plataforma (infra/docker/postgres/init/*.sql) → preflight de migraciones →
# `prisma migrate deploy` con kuota_migrator → `db:check-rls` con la credencial de RUNTIME (kuota_app_login).
#
# Autoverificación de que los gates fallan de verdad (sobre bases efímeras e independientes):
#   - RLS: tras quitar FORCE en una tabla de tenant, db:check-rls DEBE salir con 1 (luego se restaura).
#   - Prerrequisitos: en una base aprovisionada SIN 02-maintenance-roles.sql, el preflight DEBE salir con 1 y no debe
#     existir historial de migraciones (no se intentó migrar).
# El superusuario del contenedor solo prepara esos escenarios negativos: las garantías de aislamiento las verifican
# las credenciales de runtime y de migración.
#
# Seguridad: contenedores con --rm, datos en tmpfs (sin volúmenes), puerto solo en 127.0.0.1, contraseñas aleatorias
# por ejecución que nunca se imprimen (en GitHub Actions se enmascaran). No toca ninguna base persistente.
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
require_docker
use_project_node

IMAGE="$(sed -nE 's/^[[:space:]]*image:[[:space:]]*(postgres:18@sha256:[0-9a-f]{64})[[:space:]]*$/\1/p' "$KUOTA_ROOT/infra/docker/compose.yaml")"
[ -n "$IMAGE" ] || die "compose.yaml no declara postgres:18 fijado por digest"
CONTAINERS=()
TMPDIRS=()
cleanup() {
  for c in "${CONTAINERS[@]+"${CONTAINERS[@]}"}"; do docker rm -f "$c" >/dev/null 2>&1 || true; done
  for d in "${TMPDIRS[@]+"${TMPDIRS[@]}"}"; do rm -rf "$d"; done
}
trap cleanup EXIT

secret() { openssl rand -hex 16; }
mask() { [ -n "${GITHUB_ACTIONS:-}" ] && printf '::add-mask::%s\n' "$1"; return 0; }

# start_db <dir-de-init> → define DB_NAME, DB_PORT y las contraseñas (variables globales).
start_db() {
  local init_dir="$1"
  SU_PASSWORD="$(secret)"; MIGRATOR_PASSWORD="$(secret)"; APP_PASSWORD="$(secret)"; MAINT_PASSWORD="$(secret)"
  mask "$SU_PASSWORD"; mask "$MIGRATOR_PASSWORD"; mask "$APP_PASSWORD"; mask "$MAINT_PASSWORD"
  DB_NAME="kuota-ci-db-$$-$RANDOM"
  CONTAINERS+=("$DB_NAME")
  docker run -d --rm --name "$DB_NAME" -p 127.0.0.1::5432 --tmpfs /var/lib/postgresql \
    -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD="$SU_PASSWORD" -e POSTGRES_DB=kuota \
    -e KUOTA_MIGRATOR_PASSWORD="$MIGRATOR_PASSWORD" -e KUOTA_APP_LOGIN_PASSWORD="$APP_PASSWORD" \
    -e KUOTA_MAINTENANCE_LOGIN_PASSWORD="$MAINT_PASSWORD" \
    -v "$init_dir:/docker-entrypoint-initdb.d:ro" "$IMAGE" >/dev/null || return 1
  local deadline=$((SECONDS + 90))
  # Durante la inicialización el servidor temporal no escucha por TCP: listo = acepta TCP tras ejecutar los scripts.
  until docker exec "$DB_NAME" pg_isready -h 127.0.0.1 -U postgres -d kuota >/dev/null 2>&1; do
    [ "$SECONDS" -lt "$deadline" ] || { echo "    ✗ PostgreSQL no quedó listo"; docker logs "$DB_NAME" 2>&1 | tail -5; return 1; }
    sleep 1
  done
  DB_PORT="$(docker port "$DB_NAME" 5432/tcp | head -1 | sed 's/.*://')"
}
url() { printf 'postgresql://%s:%s@127.0.0.1:%s/kuota' "$1" "$2" "$DB_PORT"; }
superuser_sql() { docker exec -e PGPASSWORD="$SU_PASSWORD" "$DB_NAME" psql -v ON_ERROR_STOP=1 -qtA -U postgres -d kuota -c "$1"; }
backend() { (cd "$KUOTA_ROOT/backend" && "$@"); }
preflight() { DATABASE_URL_MIGRATOR="$(url kuota_migrator "$MIGRATOR_PASSWORD")" backend node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/migration-preflight.ts; }
# Con la credencial de RUNTIME (lee el catálogo); sin DATABASE_URL_CHECK para no heredar otra identidad del entorno.
check_rls() { backend env -u DATABASE_URL_CHECK DATABASE_URL_APP="$(url kuota_app_login "$APP_PASSWORD")" node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/check-rls.ts; }

positive_flow() {
  start_db "$KUOTA_ROOT/infra/docker/postgres/init" || return 1
  note "PostgreSQL efímero listo (roles de 01 y 02 aprovisionados)"
  preflight || return 1
  DATABASE_URL_MIGRATOR="$(url kuota_migrator "$MIGRATOR_PASSWORD")" backend pnpm exec prisma migrate deploy || return 1
  check_rls || return 1
  preflight || return 1
  POSITIVE_DB="$DB_NAME"
}

rls_negative() {
  [ -n "${POSITIVE_DB:-}" ] || { echo "    ✗ requiere el flujo positivo"; return 1; }
  superuser_sql 'ALTER TABLE kuota.dev_probe_items NO FORCE ROW LEVEL SECURITY' || return 1
  local status=0
  check_rls || status=$?
  superuser_sql 'ALTER TABLE kuota.dev_probe_items FORCE ROW LEVEL SECURITY' || return 1
  [ "$status" -eq 1 ] || { echo "    ✗ db:check-rls debía salir con 1 sin FORCE (salió con $status)"; return 1; }
  note "db:check-rls detectó la tabla sin FORCE (exit 1) y la base se restauró"
  check_rls >/dev/null || { echo "    ✗ tras restaurar, db:check-rls debía volver a 0"; return 1; }
}

preflight_negative() {
  local dir
  dir="$(mktemp -d)"
  TMPDIRS+=("$dir")
  cp "$KUOTA_ROOT/infra/docker/postgres/init/01-roles.sql" "$dir/"
  chmod 0755 "$dir" && chmod 0644 "$dir/01-roles.sql"
  start_db "$dir" || return 1
  local status=0
  preflight || status=$?
  [ "$status" -eq 1 ] || { echo "    ✗ el preflight debía salir con 1 sin kuota_maintenance (salió con $status)"; return 1; }
  local history
  history="$(superuser_sql "SELECT to_regclass('public._prisma_migrations') IS NULL")" || return 1
  [ "$history" = "t" ] || { echo "    ✗ existe historial de migraciones: se intentó migrar"; return 1; }
  note "preflight bloqueó (exit 1) y no se intentó ninguna migración"
}

check "PostgreSQL 18 efímero: aprovisionamiento → preflight → migrate deploy → db:check-rls (runtime)" positive_flow
check "Autoverificación: db:check-rls falla sin FORCE RLS" rls_negative
check "Autoverificación: el preflight bloquea sin kuota_maintenance" preflight_negative
finish db-gate
