#!/usr/bin/env bash
# Prueba la selección de componentes de test-affected.sh (T032) con listas de archivos conocidas.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
FAILED=0

check() { # descripción esperado archivos…
  local name="$1" expected="$2" got
  shift 2
  got="$(KUOTA_CHANGED_FILES="$(printf '%s\n' "$@")" "$ROOT/scripts/dev/test-affected.sh" HEAD --list | paste -sd' ' -)"
  if [ "$got" = "$expected" ]; then echo "  ✓ $name → ${got:-ninguno}"; else echo "  ✗ $name: esperado '$expected', obtenido '$got'"; FAILED=$((FAILED + 1)); fi
}

echo "Selección de componentes afectados"
check "solo documentación" "" docs/architecture/vision.md README.md
check "backend" "backend" backend/src/main.ts
check "lockfile" "backend" pnpm-lock.yaml
check "flutter" "flutter" flutter/apps/admin_web/lib/main.dart
check "contrato → suite completa" "backend contracts flutter" contracts/openapi/schemas/Money.yaml
check "Constitución → suite completa" "backend contracts flutter" .specify/memory/constitution.md
check "CI → suite completa" "backend contracts flutter" .github/workflows/ci.yml
check "filtros → suite completa" "backend contracts flutter" scripts/dev/path-filters.sh
check "prefijo no engañoso" "" backend-notes.md flutterx/a.txt
check "backend y flutter" "backend flutter" backend/package.json flutter/pubspec.yaml

if "$ROOT/scripts/dev/test-affected.sh" no-existe --list >/dev/null 2>&1; then
  echo "  ✗ una base inexistente debería fallar"; FAILED=$((FAILED + 1))
else
  echo "  ✓ base inexistente → error"
fi

[ "$FAILED" -eq 0 ] && echo "Resultado: selección correcta en todos los casos." || echo "Resultado: $FAILED caso(s) fallaron."
exit "$FAILED"
