#!/usr/bin/env bash
# Prueba del gate anti punto flotante (T065; R-10): el verificador de TypeScript solo aprueba si la regla REAL rechaza
# cada infracción marcada del archivo defectuoso; la regla de Dart detecta double/num fuera de comentarios y literales
# y devuelve PENDIENTE (3), nunca PASS, si el paquete no existe; check-no-float.sh falla si el verificador falla; y los
# archivos afectados activan el job correcto. Sin red ni Docker.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
source "$ROOT/scripts/ci/lib.sh"
use_project_node
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
FAILED=0
expect() { # nombre esperado obtenido
  if [ "$2" = "$3" ]; then echo "  ✓ $1 → $3"; else echo "  ✗ $1: esperado $2, obtenido $3"; FAILED=$((FAILED + 1)); fi
}
ts_check() { (cd "$ROOT/backend" && node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/check-no-float.ts "$@" >/dev/null 2>&1); echo $?; }
dart_check() { "$ROOT/scripts/ci/check-no-float-dart.sh" "$@" >/dev/null 2>&1; echo $?; }

echo "Anti-float TypeScript (backend/scripts/check-no-float.ts)"
expect "archivo defectuoso de referencia (T060): todas las infracciones rechazadas" 0 "$(ts_check)"
cat >"$TMP/corregido.ts.txt" <<'EOF'
export interface PaymentRequest {
  amount: bigint; // ANTI-FLOAT: ya no infringe; si la regla "aprobara" este archivo, el verificador debe fallar
}
EOF
expect "línea marcada que no infringe → la prueba no probaría nada" 1 "$(ts_check "$TMP/corregido.ts.txt")"
printf 'export const amount: number = 1;\n' >"$TMP/sin-marcas.ts.txt"
expect "archivo sin líneas marcadas" 1 "$(ts_check "$TMP/sin-marcas.ts.txt")"
cat >"$TMP/parcial.ts.txt" <<'EOF'
export const total = parseFloat('1.5'); // ANTI-FLOAT: detectada
export const count: number = 3; // ANTI-FLOAT: un contador legítimo no la infringe → debe fallar el verificador
EOF
expect "una infracción marcada sin detectar basta para fallar" 1 "$(ts_check "$TMP/parcial.ts.txt")"
printf 'export const = ; // ANTI-FLOAT\n' >"$TMP/roto.ts.txt"
expect "archivo que ESLint no puede analizar" 1 "$(ts_check "$TMP/roto.ts.txt")"
KUOTA_FLOAT_FIXTURE="$TMP/corregido.ts.txt" "$ROOT/scripts/ci/check-no-float.sh" ts >/dev/null 2>&1
expect "check-no-float.sh ts falla si la regla no rechaza el archivo defectuoso" 1 "$?"

echo "Anti-float Dart (scripts/ci/check-no-float-dart.sh)"
expect "paquete inexistente → PENDIENTE (3), no PASS" 3 "$(dart_check "$TMP/no-existe")"
mkdir -p "$TMP/vacio/src"
mkdir -p "$TMP/solo-docs/src"; printf '/// double y num prohibidos (T063).\nlibrary;\n' >"$TMP/solo-docs/src/money.dart"
expect "solo comentarios y library; (sin código) → PENDIENTE (3), no PASS" 3 "$(dart_check "$TMP/solo-docs")"
expect "directorio sin archivos .dart → PENDIENTE (3), no PASS" 3 "$(dart_check "$TMP/vacio")"
dart_case() { # nombre esperado contenido
  local dir="$TMP/dart-$RANDOM"
  mkdir -p "$dir/src/money"
  printf '%s\n' "$3" >"$dir/src/money/money.dart"
  expect "$1" "$2" "$(dart_check "$dir")"
}
dart_case "tipo double en un monto" 1 'class Money { final double amount; const Money(this.amount); }'
dart_case "parámetro num" 1 'BigInt scale(num factor) => BigInt.one;'
dart_case "double.parse" 1 "final v = double.parse('1.5');"
dart_case "genérico List<num>" 1 'final List<num> parts = [];'
dart_case "toDouble()" 1 'final v = BigInt.one.toDouble();'
dart_case "infracción tras un literal con //" 1 "final url = 'http://x'; double amount = 0;"
dart_case "solo en comentarios de línea, de documentación y de bloque" 0 '// double amount
/// Nunca uses num para montos.
/* double y num están prohibidos */
final BigInt amountMinor = BigInt.zero;'
dart_case "solo dentro de literales (simples, dobles, raw y triples)" 0 "final a = 'double';
final b = \"num\";
final c = r'double \\';
final d = '''
num en un texto multilínea
''';"
dart_case "identificadores que solo contienen las palabras" 0 'final doubled = BigInt.two; final numParts = 3; int _numerator = 1;'
dart_case "comillas dentro de un comentario no ocultan código posterior" 1 "// don't
double amount = 0;"

echo "Selección de jobs (scripts/ci/affected.sh)"
affected_of() { KUOTA_CHANGED_FILES="$1" "$ROOT/scripts/ci/affected.sh" | tr '\n' ' ' | sed 's/ $//'; }
expect "archivo defectuoso de referencia → backend" "general backend" "$(affected_of backend/test/fixtures/float-violation.ts.txt)"
expect "código de Money → backend" "general backend" "$(affected_of backend/src/common/money/money.ts)"
expect "financial_domain → flutter" "general flutter" "$(affected_of flutter/packages/financial_domain/lib/src/money/money.dart)"
expect "script del gate → suite completa" "general backend contracts flutter" "$(affected_of scripts/ci/check-no-float.sh)"

[ "$FAILED" -eq 0 ] && echo "Resultado: gate anti punto flotante correcto en todos los casos." || echo "Resultado: $FAILED caso(s) fallaron."
exit "$FAILED"
