#!/usr/bin/env bash
# Autoverificación de scripts/ci/check-required-suites.mjs (T048, T108) con informes de Vitest SINTÉTICOS construidos a
# partir de la lista real scripts/ci/required-suites.txt. No ejecuta Vitest ni requiere Docker.
#   1. Todas las suites obligatorias con pruebas aprobadas → exit 0.
#   2. Falta cualquiera de las suites de excepciones de acceso añadidas por T108 → exit 1 nombrándola.
#   3. Una suite obligatoria con una prueba omitida → exit 1.
#   4. Las cuatro suites de T108 figuran en la lista.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
source "$ROOT/scripts/ci/lib.sh"
use_project_node
TMP="$(mktemp -d)"
trap 'rm -rf "${TMP:?}"' EXIT
LIST="$ROOT/scripts/ci/required-suites.txt"
FAILED=0
T108=(test/integration/metrics.spec.ts test/integration/meta-compatibility.spec.ts test/integration/not-found.spec.ts
  test/integration/cors.spec.ts)

report() { # salida [suite-a-omitir] [suite-con-skip]
  node - "$LIST" "$1" "${2:-}" "${3:-}" <<'NODE'
const { readFileSync, writeFileSync } = require('node:fs');
const [list, out, omit, skip] = process.argv.slice(2);
const suites = readFileSync(list, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
const testResults = suites.filter((s) => s !== omit).map((s) => ({
  name: `/repo/backend/${s}`,
  status: 'passed',
  assertionResults: [{ status: 'passed' }, ...(s === skip ? [{ status: 'skipped' }] : [])],
}));
writeFileSync(out, JSON.stringify({ testResults }));
NODE
}
expect() { # nombre exit-esperado texto informe
  local output status
  output="$(node "$ROOT/scripts/ci/check-required-suites.mjs" "$4" "$LIST" 2>&1)"
  status=$?
  if [ "$status" -eq "$2" ] && grep -qF -- "$3" <<<"$output"; then echo "  ✓ $1 → exit $status"; else
    echo "  ✗ $1: se esperaba exit $2 con '$3', se obtuvo exit $status"; echo "$output" | head -5 | sed 's/^/      /'
    FAILED=$((FAILED + 1))
  fi
}

echo "Suites obligatorias (check-required-suites.mjs)"
for suite in "${T108[@]}"; do
  if grep -qxF "$suite" "$LIST"; then echo "  ✓ $suite está en la lista"; else echo "  ✗ falta $suite en la lista"; FAILED=$((FAILED + 1)); fi
done
report "$TMP/all.json"
expect "todas ejecutadas y aprobadas" 0 "suites obligatorias ejecutadas" "$TMP/all.json"
for suite in "${T108[@]}"; do
  report "$TMP/omit.json" "$suite"
  expect "sin $suite" 1 "$suite: suite obligatoria NO ejecutada" "$TMP/omit.json"
done
report "$TMP/skip.json" "" "test/integration/cors.spec.ts"
expect "cors.spec.ts con una prueba omitida" 1 "test/integration/cors.spec.ts: 1 prueba(s) omitidas" "$TMP/skip.json"

[ "$FAILED" -eq 0 ] && echo "Resultado: el control de suites obligatorias cubre T108." || echo "Resultado: $FAILED caso(s) fallaron."
exit "$FAILED"
