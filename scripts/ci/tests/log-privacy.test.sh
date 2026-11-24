#!/usr/bin/env bash
# Autoverificación del gate SC-009 (T102): la comprobación de la salida AGREGADA de logs de la suite del backend
# (backend/test/support/log-privacy.global.ts) debe hacer fallar Vitest ante una fuga deliberada por cada vía de captura
# (stream en memoria, log de una app sin stream propio, salida de proceso hijo, valor registrado en ejecución en forma
# codificada) y su informe debe nombrar cada valor sin imprimirlo. La salida de Vitest (que contiene las fugas
# ficticias deliberadas) no se muestra. No requiere Docker.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
source "$ROOT/scripts/ci/lib.sh"
use_project_node
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
FAILED=0
ok() { echo "  ✓ $1"; }
ko() { echo "  ✗ $1"; FAILED=1; }

echo "Gate de privacidad de logs de la suite (SC-009, T102)"
(cd "$ROOT/backend" && KUOTA_LOG_PRIVACY_SELFTEST=1 KUOTA_LOG_PRIVACY_REPORT="$TMP/report.json" \
  pnpm exec vitest run >"$TMP/vitest.out" 2>&1)
status=$?
# Exactamente 1 (fallo de Vitest): 127 u otro código sería un fallo de ejecución, no del gate.
[ "$status" -eq 1 ] && ok "Vitest termina con 1 ante las fugas deliberadas" \
  || ko "Vitest terminó con $status (se esperaba 1 por las fugas deliberadas)"

if [ -s "$TMP/report.json" ]; then
  node - "$TMP/report.json" "$TMP/vitest.out" <<'NODE' || FAILED=1
const { readFileSync } = require('node:fs');
const [report, out] = [JSON.parse(readFileSync(process.argv[2], 'utf8')), readFileSync(process.argv[3], 'utf8')];
const expected = [
  'CURP',
  'dato arbitrario de encabezado',
  'contraseña de URL de base de datos',
  'contraseña generada de prueba (registrado en ejecución)',
];
let failed = false;
const names = report.leaks.map((leak) => leak.name);
for (const name of expected) {
  if (names.includes(name)) console.log(`  ✓ detecta: ${name}`);
  else { console.log(`  ✗ no detecta: ${name}`); failed = true; }
}
if (names.length !== expected.length) { console.log(`  ✗ filtraciones inesperadas: ${names.join(', ')}`); failed = true; }
// El informe (lo único que ve quien ejecuta la suite) no contiene ningún valor filtrado.
const leakedValues = ['GODE561231HDFRRN09', 'DATO-ARBITRARIO-c0ffee', 'ficticio-secreto-db', 'gener@da/secreta+1'];
if (leakedValues.some((value) => report.text.includes(value))) { console.log('  ✗ el informe imprime un valor'); failed = true; }
else console.log('  ✓ el informe nombra los valores sin imprimirlos');
if (!out.includes('SC-009:')) { console.log('  ✗ Vitest no muestra el informe SC-009'); failed = true; }
process.exit(failed ? 1 : 0);
NODE
else
  ko "no se generó el informe del gate"
fi

if [ "$FAILED" -eq 0 ]; then echo "✓ gate SC-009: autoverificación superada"; else echo "✗ gate SC-009: autoverificación fallida"; fi
exit "$FAILED"
