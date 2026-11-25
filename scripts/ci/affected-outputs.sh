#!/usr/bin/env bash
# Paso del job `changes` (T052): convierte la lista JSON de archivos cambiados de dorny/paths-filter (CHANGED_JSON) en
# las salidas del job, usando scripts/ci/affected.sh (fuente única de la selección). Si la lista no está disponible,
# ejecuta TODOS los componentes (ante la duda, suite completa).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
if [ -n "${CHANGED_JSON:-}" ] && changed="$(jq -r '.[]' <<<"$CHANGED_JSON" 2>/dev/null)"; then
  components="$(KUOTA_CHANGED_FILES="$changed" "$ROOT/scripts/ci/affected.sh")"
else
  echo "::warning::sin lista de archivos cambiados: se ejecutan todos los componentes"
  components="$(printf 'general\nbackend\ncontracts\nflutter\n')"
fi
out="${GITHUB_OUTPUT:-/dev/stdout}"
for component in backend contracts flutter; do
  if grep -qx "$component" <<<"$components"; then echo "$component=true"; else echo "$component=false"; fi
done >>"$out"
if [ -f "$ROOT/flutter/pubspec.yaml" ]; then echo "flutter_present=true"; else echo "flutter_present=false"; fi >>"$out"
echo "Componentes: $(paste -sd' ' - <<<"$components")"
