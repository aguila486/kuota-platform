#!/usr/bin/env bash
# Prueba breaking.sh (T024) con variantes del contrato real: los cambios compatibles pasan y los incompatibles fallan.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
FAILED=0

(cd "$ROOT" && pnpm exec redocly bundle contracts/openapi/kuota-core.v1.yaml --config contracts/openapi/redocly.yaml -o "$WORK/base.yaml" >/dev/null 2>&1)
python3 "$ROOT/scripts/contracts/tests/make-breaking-variants.py" "$WORK/base.yaml" "$WORK" >/dev/null

check() { # variante código-esperado texto-esperado
  local output status
  output="$("$ROOT/scripts/contracts/breaking.sh" --files "$WORK/base.yaml" "$WORK/$1.yaml" 2>&1)"; status=$?
  if [ "$status" -eq "$2" ] && { [ -z "$3" ] || grep -q "$3" <<<"$output"; }; then
    echo "  ✓ $1 → exit $status${3:+ ($3)}"
  else
    echo "  ✗ $1: se esperaba exit $2${3:+ con '$3'}, se obtuvo exit $status"; echo "$output" | head -8 | sed 's/^/      /'
    FAILED=$((FAILED + 1))
  fi
}

echo "Detección de cambios incompatibles (oasdiff 1.39.0)"
check unchanged 0 ""
check compatible 0 ""
check endpoint-removed 1 "api-path-removed"
check property-type-changed 1 "response-property-type-changed"
check request-property-required 1 "request-property-became-required"
check response-required-removed 1 "response-property-became-optional"
check response-became-nullable 1 "response-property-became-nullable"

# Modo por referencia Git: si HEAD ya contiene el contrato, compararlo con el árbol de trabajo no debe fallar.
if git -C "$ROOT" cat-file -e "HEAD:contracts/openapi/kuota-core.v1.yaml" 2>/dev/null && git -C "$ROOT" diff --quiet HEAD -- contracts/openapi; then
  if "$ROOT/scripts/contracts/breaking.sh" HEAD >/dev/null 2>&1; then echo "  ✓ modo REF (HEAD contra árbol sin cambios) → exit 0"; else echo "  ✗ modo REF falló"; FAILED=$((FAILED + 1)); fi
else
  echo "  - modo REF omitido: HEAD aún no contiene el contrato o hay cambios sin confirmar en contracts/openapi"
fi

[ "$FAILED" -eq 0 ] && echo "Resultado: detección correcta en todos los casos." || echo "Resultado: $FAILED caso(s) fallaron."
exit "$FAILED"
