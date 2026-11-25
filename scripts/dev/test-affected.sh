#!/usr/bin/env bash
# Pruebas solo de los componentes afectados (T032; FR-002). Uso: scripts/dev/test-affected.sh <base> [--list]
# Detecta los archivos cambiados respecto a <base> (git diff --name-only <base>...HEAD) más los cambios locales sin
# confirmar, y aplica los mismos filtros que CI (scripts/dev/path-filters.sh). --list solo imprime los componentes.
# KUOTA_CHANGED_FILES (una ruta por línea) sustituye la detección por git; solo para las pruebas de este script.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
source "$KUOTA_ROOT/scripts/dev/path-filters.sh"
cd "$KUOTA_ROOT"

BASE="${1:-}"
[ -n "$BASE" ] || die "Uso: scripts/dev/test-affected.sh <base> [--list]   (p. ej. main)"
git rev-parse --verify --quiet "$BASE^{commit}" >/dev/null || die "La referencia '$BASE' no existe."
LIST_ONLY=false
[ "${2:-}" = "--list" ] && LIST_ONLY=true

if [ -n "${KUOTA_CHANGED_FILES+x}" ]; then
  CHANGED="$KUOTA_CHANGED_FILES"
else
  CHANGED="$( {
    git diff --name-only "$BASE"...HEAD
    git diff --name-only HEAD
    git ls-files --others --exclude-standard
  } | sort -u)"
fi

AFFECTED=()
full=false
while IFS= read -r file; do
  [ -n "$file" ] || continue
  if matches_filter "$file" "${FULL_SUITE[@]}"; then full=true; break; fi
done <<<"$CHANGED"

if $full; then
  AFFECTED=("${COMPONENTS[@]}")
else
  for component in "${COMPONENTS[@]}"; do
    filter="FILTER_${component}[@]"
    while IFS= read -r file; do
      [ -n "$file" ] || continue
      if matches_filter "$file" "${!filter}"; then AFFECTED+=("$component"); break; fi
    done <<<"$CHANGED"
  done
fi

if $LIST_ONLY; then
  printf '%s\n' "${AFFECTED[@]+"${AFFECTED[@]}"}"
  exit 0
fi
step "Componentes afectados respecto a $BASE: ${AFFECTED[*]:-ninguno}"
$full && note "incluye cambios que disparan la suite completa (contrato, Constitución o CI)"
[ ${#AFFECTED[@]} -gt 0 ] || { note "Nada que probar."; exit 0; }
KUOTA_BASE_REF="$BASE" exec "$KUOTA_ROOT/scripts/dev/test-all.sh" "${AFFECTED[@]}"
