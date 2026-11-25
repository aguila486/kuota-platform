#!/usr/bin/env bash
# Componentes afectados para CI (T045; FR-002; R-17). Imprime un componente por línea: siempre `general` y, según
# scripts/dev/path-filters.sh (fuente única, la misma que usa make test-affected), `backend`, `contracts` y `flutter`.
# Los cambios de contrato, Constitución, CI o filtros disparan la suite completa: ante la duda se ejecuta todo.
#
# Entrada: la lista de archivos cambiados, una ruta por línea, en KUOTA_CHANGED_FILES (en CI la aporta
# dorny/paths-filter) o, si no está definida, `git diff --name-only <base>...HEAD` más los cambios locales.
# Uso: scripts/ci/affected.sh [base]   (base por defecto: main)
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
source "$KUOTA_ROOT/scripts/dev/path-filters.sh"
cd "$KUOTA_ROOT"

if [ -n "${KUOTA_CHANGED_FILES+x}" ]; then
  CHANGED="$KUOTA_CHANGED_FILES"
else
  BASE="${1:-main}"
  git rev-parse --verify --quiet "$BASE^{commit}" >/dev/null || die "La referencia '$BASE' no existe."
  CHANGED="$( {
    git diff --name-only "$BASE"...HEAD
    git diff --name-only HEAD
    git ls-files --others --exclude-standard
  } | sort -u)"
fi

echo general
full=false
while IFS= read -r file; do
  [ -n "$file" ] || continue
  if matches_filter "$file" "${FULL_SUITE[@]}"; then full=true; break; fi
done <<<"$CHANGED"

for component in "${COMPONENTS[@]}"; do
  if $full; then echo "$component"; continue; fi
  filter="FILTER_${component}[@]"
  while IFS= read -r file; do
    [ -n "$file" ] || continue
    if matches_filter "$file" "${!filter}"; then echo "$component"; break; fi
  done <<<"$CHANGED"
done
