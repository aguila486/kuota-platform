#!/usr/bin/env bash
# Job `backend` de CI (T048; FR-035; R-17). Lo invoca .github/workflows/ci.yml y lo reproduce `run-local.sh backend`.
#   1. Instalación reproducible (pnpm install --frozen-lockfile).
#   2. Lint (ESLint + dependency-cruiser), gate anti punto flotante (T065: archivo defectuoso rechazado, más su
#      autoverificación), typecheck, formato (Prettier) y build.
#   3. Todas las pruebas con cobertura y umbrales (unitarias, integración con Testcontainers, tenancy y contrato):
#      `vitest run --coverage`; los umbrales de vitest.config.ts hacen fallar si no se alcanzan.
#   4. Suites obligatorias ejecutadas y sin omisiones (scripts/ci/required-suites.txt).
#   5. test:idempotency (SC-006: 100 repeticiones).
#   6. Gate de PostgreSQL efímero: aprovisionamiento → preflight → migrate deploy → db:check-rls, con autoverificación.
#   7. Autoverificación del gate de dependencias y osv-scanner sobre pnpm-lock.yaml: falla con severidad alta o crítica
#      o con un informe inválido (SEC-2026-001).
# Salida: 0 sin fallos; 1 si alguna verificación falló. Requiere Docker.
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
require_docker
use_project_node
cd "$KUOTA_ROOT"
REPORT_DIR="$(mktemp -d)"
trap 'rm -rf "$REPORT_DIR"' EXIT

backend() { (cd "$KUOTA_ROOT/backend" && "$@"); }

tests_with_coverage() {
  backend pnpm run prisma:generate >/dev/null &&
    backend pnpm exec vitest run --coverage --reporter=default --reporter=json \
      --outputFile.json="$REPORT_DIR/vitest.json"
}
required_suites() {
  [ -f "$REPORT_DIR/vitest.json" ] || { echo "    ✗ no hay informe de Vitest (las pruebas no llegaron a ejecutarse)"; return 1; }
  node scripts/ci/check-required-suites.mjs "$REPORT_DIR/vitest.json" scripts/ci/required-suites.txt
}
dependency_scan() {
  docker run --rm -v "$KUOTA_ROOT/pnpm-lock.yaml:/src/pnpm-lock.yaml:ro" "$OSV_SCANNER_IMAGE" \
    scan source --lockfile=/src/pnpm-lock.yaml --format json >"$REPORT_DIR/osv.json" 2>"$REPORT_DIR/osv.log"
  local status=$?
  # 0 = sin vulnerabilidades; 1 = hay vulnerabilidades (se evalúa su severidad); otro = error de la herramienta.
  if [ "$status" -gt 1 ]; then
    tail -5 "$REPORT_DIR/osv.log"
    return "$status"
  fi
  node scripts/ci/osv-gate.mjs "$REPORT_DIR/osv.json" "$status"
}

check "Instalación reproducible (pnpm install --frozen-lockfile)" pnpm install --frozen-lockfile
check "Lint: ESLint + dependency-cruiser" pnpm --filter backend run lint
check "Anti punto flotante TS: el archivo defectuoso se rechaza y el lint real pasa (check-no-float.sh ts; T065)" \
  scripts/ci/check-no-float.sh ts
check "Autoverificación del gate anti punto flotante (scripts/ci/tests/check-no-float.test.sh)" \
  scripts/ci/tests/check-no-float.test.sh
check "Typecheck" pnpm --filter backend run typecheck
check "Formato (Prettier)" pnpm --filter backend run format:check
check "Build" pnpm --filter backend run build
check "Pruebas: unitarias, integración, tenancy y contrato, con cobertura y umbrales" tests_with_coverage
check "Suites obligatorias ejecutadas y sin omisiones" required_suites
check "Idempotencia: test:idempotency (100 repeticiones, SC-006)" pnpm --filter backend run test:idempotency
check "PostgreSQL 18 efímero, preflight y db:check-rls (scripts/ci/db-gate.sh)" "$KUOTA_ROOT/scripts/ci/db-gate.sh"
check "Autoverificación del gate de dependencias (scripts/ci/tests/osv-gate.test.sh)" scripts/ci/tests/osv-gate.test.sh
check "Dependencias: osv-scanner sobre pnpm-lock.yaml (falla en alta/crítica)" dependency_scan
finish backend
