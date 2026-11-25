#!/usr/bin/env bash
# Prueba del agregador `CI: resultado` (scripts/ci/ci-result.sh): un job saltado o cancelado de un componente afectado
# no cuenta como aprobado; flutter ausente se informa como PENDIENTE (G12; T052, T055). Requiere jq.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
FAILED=0
mk() { printf '{"changes":{"result":"success","outputs":{"backend":"%s","contracts":"%s","flutter":"%s","flutter_present":"%s"}},"general":{"result":"%s"},"backend":{"result":"%s"},"contracts":{"result":"%s"},"flutter":{"result":"%s"}}' "$@"; }
echo "Agregador CI: resultado"
while IFS='|' read -r name expect args; do
  read -r -a a <<<"$args"
  NEEDS_JSON="$(mk "${a[@]}")" "$ROOT/scripts/ci/ci-result.sh" >/dev/null 2>&1
  got=$?
  if [ "$got" = "$expect" ]; then echo "  ✓ $name → $got"; else echo "  ✗ $name: esperado $expect, obtenido $got"; FAILED=$((FAILED + 1)); fi
done <<'EOF'
solo docs|0|false false false false success skipped skipped skipped
backend afectado y verde|0|true false false false success success skipped skipped
backend falla|1|true false false false success failure skipped skipped
backend afectado pero saltado|1|true false false false success skipped skipped skipped
backend cancelado|1|true false false false success cancelled skipped skipped
contrato con flutter ausente (PENDIENTE, no aprobado)|0|true true true false success success success skipped
contrato con contracts fallido|1|true true true false success success failure skipped
general falla|1|false false false false failure skipped skipped skipped
flutter presente y saltado|1|false false true true success skipped skipped skipped
EOF
if NEEDS_JSON='{"changes":{"result":"failure"}}' "$ROOT/scripts/ci/ci-result.sh" >/dev/null 2>&1; then
  echo "  ✗ changes fallido debía fallar"; FAILED=$((FAILED + 1))
else echo "  ✓ changes fallido → falla"; fi
[ "$FAILED" -eq 0 ] && echo "Resultado: agregador correcto en todos los casos." || echo "Resultado: $FAILED caso(s) fallaron."
exit "$FAILED"
