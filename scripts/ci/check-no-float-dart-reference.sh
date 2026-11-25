#!/usr/bin/env bash
# Autoverificación de la regla anti punto flotante de Dart sobre su archivo defectuoso de referencia (T065; R-10;
# Constitución IV; ADR-0007). Equivale, en Dart, a backend/scripts/check-no-float.ts:
#   - analiza flutter/packages/financial_domain/test/fixtures/float-violation.dart.txt con la regla REAL
#     (check-no-float-dart.sh) como si fuera un archivo de lib/;
#   - EXIGE que cada línea marcada con `ANTI-FLOAT` (en código, no en un comentario de línea completo) se detecte, y que
#     ninguna línea sin marca se marque (falsos positivos en comentarios, literales o identificadores).
# Uso: scripts/ci/check-no-float-dart-reference.sh [archivo-defectuoso]
# Salida: 0 si la regla rechaza exactamente las líneas marcadas; 1 en cualquier otro caso (incluido un archivo sin
# líneas marcadas, que no probaría nada).
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FIXTURE="${1:-$ROOT/flutter/packages/financial_domain/test/fixtures/float-violation.dart.txt}"
[ -f "$FIXTURE" ] || { echo "  ✗ no existe el archivo defectuoso de referencia: ${FIXTURE#"$ROOT"/}"; exit 1; }
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/lib/src/money"
cp "$FIXTURE" "$TMP/lib/src/money/float_violation.dart"

expected="$(grep -n 'ANTI-FLOAT' "$FIXTURE" | grep -vE '^[0-9]+:[[:space:]]*//' | cut -d: -f1 | sort -n | tr '\n' ' ')"
if [ -z "$expected" ]; then
  echo "  ✗ el archivo de referencia no tiene líneas marcadas con ANTI-FLOAT: la prueba no probaría nada"
  exit 1
fi
output="$("$ROOT/scripts/ci/check-no-float-dart.sh" "$TMP/lib")"
status=$?
detected="$(sed -nE 's/.*float_violation\.dart:([0-9]+):.*/\1/p' <<<"$output" | sort -n | uniq | tr '\n' ' ')"
if [ "$status" -ne 1 ]; then
  echo "  ✗ la regla no rechazó el archivo defectuoso (salida $status, se esperaba 1)"
  exit 1
fi
if [ "$detected" != "$expected" ]; then
  echo "  ✗ líneas detectadas [${detected% }] distintas de las marcadas [${expected% }]"
  exit 1
fi
echo "  ✓ la regla Dart rechaza exactamente las $(wc -w <<<"$expected" | tr -d ' ') líneas marcadas y ninguna trampa"
