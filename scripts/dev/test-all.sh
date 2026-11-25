#!/usr/bin/env bash
# Pruebas de todos los componentes (T032; FR-002). Uso: scripts/dev/test-all.sh [backend] [contracts] [flutter]
# Sin argumentos ejecuta todos. Ejecuta cada componente aunque otro falle y termina con 1 si alguno falló.
# Requiere Docker (Testcontainers y oasdiff). KUOTA_BASE_REF fija la base de contracts:breaking (por defecto main).
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
cd "$KUOTA_ROOT"

SELECTED=("$@")
[ ${#SELECTED[@]} -gt 0 ] || SELECTED=(backend contracts flutter)
BASE_REF="${KUOTA_BASE_REF:-main}"
RESULTS=()
FAILED=0

run() { # nombre comando…
  local name="$1"
  shift
  step "$name"
  if "$@"; then RESULTS+=("✓ $name"); else RESULTS+=("✗ $name"); FAILED=$((FAILED + 1)); fi
}

for component in "${SELECTED[@]}"; do
  case "$component" in
    backend)
      run "backend: tipos" pnpm --filter backend run typecheck
      run "backend: lint + dependencias" pnpm --filter backend run lint
      run "backend: formato" pnpm --filter backend run format:check
      run "backend: pruebas + cobertura" pnpm --filter backend run test:cov
      ;;
    contracts)
      run "contracts: lint" pnpm contracts:lint
      run "contracts: pruebas de reglas y de detección" pnpm contracts:test
      # Sin contrato en la base no hay comparación: se informa OMITIDO, nunca ✓ (G12: un omitido no es un PASS).
      if git rev-parse --verify --quiet "$BASE_REF^{commit}" >/dev/null &&
        git cat-file -e "$BASE_REF:contracts/openapi/kuota-core.v1.yaml" 2>/dev/null; then
        run "contracts: cambios incompatibles vs $BASE_REF" pnpm contracts:breaking "$BASE_REF"
      else
        step "contracts: cambios incompatibles vs $BASE_REF"
        note "omitido: $BASE_REF no contiene el contrato (no hay baseline legítimo)"
        RESULTS+=("- contracts: cambios incompatibles vs $BASE_REF: OMITIDO (sin baseline)")
      fi
      ;;
    flutter)
      if [ -f flutter/pubspec.yaml ]; then
        run "flutter: análisis" bash -c 'cd flutter && fvm dart run melos run analyze'
        run "flutter: pruebas" bash -c 'cd flutter && fvm dart run melos run test'
      else
        step "flutter"
        note "omitido: flutter/ aún no existe (lo crean T080+)"
        RESULTS+=("- flutter: omitido (no existe)")
      fi
      ;;
    *) die "Componente desconocido: $component (válidos: backend, contracts, flutter)" ;;
  esac
done

printf '\nResumen\n'
printf '  %s\n' "${RESULTS[@]}"
[ "$FAILED" -eq 0 ] && printf 'Resultado: verde\n' || printf 'Resultado: %s verificación(es) fallaron\n' "$FAILED"
exit $((FAILED > 0))
