#!/usr/bin/env bash
# Gate de cobertura de los paquetes compartidos de Flutter/Dart (C1 de T092; Constitución X; FR-035).
# Para cada paquete de flutter/packages/ ejecuta sus pruebas en la VM con cobertura de líneas y ramas y aplica
# tool/coverage_gate.dart con los mínimos de la Constitución:
#   - financial_domain (dominio financiero): 90 % de líneas y 90 % de ramas;
#   - el resto de paquetes compartidos: 80 % de líneas y 80 % de ramas.
# Paquetes Dart puro → `dart test -p vm --coverage-path --branch-coverage` (la cobertura solo existe en la VM; las mismas
# pruebas corren además en Chrome con `melos run test`). Paquetes con Flutter → `flutter test --coverage
# --branch-coverage`. Un paquete sin pruebas, sin informe o con pruebas fallidas hace fallar el gate (nunca PASS).
# Las apps no son paquetes compartidos: la Constitución no les fija mínimo.
# Uso: scripts/ci/check-dart-coverage.sh [directorio-flutter]   (por defecto, flutter/; requiere el SDK del proyecto)
# Salida: 0 todos los paquetes cumplen; 1 alguno no cumple o sus pruebas fallan; 2 entrada inválida.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FLUTTER_DIR="$(cd "${1:-$ROOT/flutter}" && pwd)" || { echo "  ✗ no existe el directorio Flutter"; exit 2; }
command -v dart >/dev/null 2>&1 || { echo "  ✗ falta el SDK de Dart/Flutter del proyecto"; exit 2; }
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

threshold() { [ "$1" = financial_domain ] && echo 90 || echo 80; }
packages=()
for dir in "$FLUTTER_DIR"/packages/*/; do [ -f "$dir/pubspec.yaml" ] && packages+=("$(basename "$dir")"); done
[ ${#packages[@]} -gt 0 ] || { echo "  ✗ no hay paquetes en ${FLUTTER_DIR}/packages"; exit 2; }

failed=0
for name in "${packages[@]}"; do
  dir="$FLUTTER_DIR/packages/$name"
  lcov="$TMP/$name.lcov"
  min="$(threshold "$name")"
  if [ ! -d "$dir/test" ]; then
    echo "  ✗ $name: sin directorio test/ (paquete compartido sin pruebas)"
    failed=1
    continue
  fi
  if grep -qE '^[[:space:]]+flutter:[[:space:]]*$' "$dir/pubspec.yaml" && grep -qE '^[[:space:]]+sdk:[[:space:]]*flutter' "$dir/pubspec.yaml"; then
    (cd "$dir" && flutter test --coverage --branch-coverage --coverage-path="$lcov" >"$TMP/$name.log" 2>&1)
  else
    (cd "$dir" && dart test -p vm --coverage-path="$lcov" --branch-coverage >"$TMP/$name.log" 2>&1)
  fi
  status=$?
  if [ "$status" -ne 0 ]; then
    echo "  ✗ $name: las pruebas fallaron (salida $status); no hay cobertura válida"
    tail -20 "$TMP/$name.log" | sed 's/^/      /'
    failed=1
    continue
  fi
  (cd "$FLUTTER_DIR" && dart run tool/coverage_gate.dart "$dir" "$lcov" "$min" "$min")
  status=$?
  case "$status" in
    0) ;;
    1) failed=1 ;;
    *) exit 2 ;;
  esac
done
exit "$failed"
