#!/usr/bin/env bash
# Job `contracts` de CI (T049; FR-027..FR-030; R-13, R-14, R-17).
#   A. Estructura: lint de Redocly (`pnpm contracts:lint`) y pruebas de las reglas propias y del detector de cambios
#      incompatibles (`pnpm contracts:test` y `scripts/ci/tests/breaking.test.sh`, T068).
#   B. Compatibilidad: oasdiff breaking contra `main`. Mientras `main` no contenga el contrato no hay baseline
#      legítimo: se registra OMITIDO, nunca PASS, y no se sustituye por un contrato generado desde el propio HEAD.
#   C. Fixtures de dinero: validación de contracts/fixtures/money contra fixture.schema.json (Ajv 2020).
#   D. Cliente Dart regenerado sin diff: PENDIENTE hasta que exista el generador y el cliente (T069, T070; T070 depende
#      de US7/T080). Se registra PENDIENTE, nunca PASS.
# El comportamiento (respuestas reales contra el contrato: T066, T067, T095) se valida en el job `backend`, que
# también se ejecuta ante cualquier cambio en contracts/ (scripts/dev/path-filters.sh).
# Variable: KUOTA_CI_BREAKING_BASE (referencia base; por defecto `main`).
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
use_project_node
cd "$KUOTA_ROOT"
BASE="${KUOTA_CI_BREAKING_BASE:-main}"

breaking() {
  if ! git rev-parse --verify --quiet "$BASE^{commit}" >/dev/null; then
    record OMITIDO "Compatibilidad: oasdiff breaking contra $BASE" \
      "la referencia $BASE no existe en este checkout (en CI se requiere fetch-depth: 0)"
    return 0
  fi
  if ! git cat-file -e "$BASE:contracts/openapi/kuota-core.v1.yaml" 2>/dev/null; then
    record OMITIDO "Compatibilidad: oasdiff breaking contra $BASE" \
      "$BASE no contiene contracts/openapi/kuota-core.v1.yaml: no hay baseline legítimo (se desbloquea al fusionar el contrato en $BASE)"
    return 0
  fi
  step "Compatibilidad: oasdiff breaking contra $BASE"
  if scripts/contracts/breaking.sh "$BASE"; then
    record PASS "Compatibilidad: oasdiff breaking contra $BASE"
  else
    record FAIL "Compatibilidad: oasdiff breaking contra $BASE" "cambios incompatibles o error"
  fi
}

check "Estructura: Redocly lint (contracts:lint)" pnpm contracts:lint
check "Reglas propias y detector de incompatibilidades (contracts:test)" pnpm contracts:test
check "Detector de incompatibilidades: campo requerido eliminado de CompatibilityInfo (T068)" \
  scripts/ci/tests/breaking.test.sh
breaking
check "Fixtures de dinero contra fixture.schema.json (Ajv 2020)" \
  pnpm --filter backend exec vitest run test/unit/money/fixtures.spec.ts
if [ -d flutter/packages/api_client/lib/src/generated ] && [ -x scripts/contracts/generate-dart-client.sh ]; then
  check "Cliente Dart regenerado sin diff" bash -c \
    'scripts/contracts/generate-dart-client.sh && git diff --exit-code -- flutter/packages/api_client'
else
  record PENDIENTE "Cliente Dart regenerado sin diff" \
    "no existen el generador ni el cliente (T069, T070; T070 depende de US7/T080)"
fi
finish contracts
