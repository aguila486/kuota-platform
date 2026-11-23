# Filtros por ruta de los componentes (FR-002). Fuente única para test-affected.sh y para el CI de G12
# (docs/architecture/monorepo-strategy.md §4, docs/architecture/deployment-architecture.md, R-17).
# Una entrada terminada en "/" es un directorio (prefijo); cualquier otra es un archivo exacto.
FILTER_backend=(backend/ contracts/ pnpm-lock.yaml)
FILTER_contracts=(contracts/)
FILTER_flutter=(flutter/ contracts/)
# Cambios que disparan la suite completa (docs/quality/testing-strategy.md): contrato, Constitución y configuración de CI.
FULL_SUITE=(contracts/ .specify/memory/ .github/workflows/ scripts/ci/ scripts/dev/path-filters.sh)
COMPONENTS=(backend contracts flutter)

# matches_filter <archivo> <entradas…>
matches_filter() {
  local file="$1" entry
  shift
  for entry in "$@"; do
    case "$entry" in
      */) [[ "$file" == "$entry"* ]] && return 0 ;;
      *) [[ "$file" == "$entry" ]] && return 0 ;;
    esac
  done
  return 1
}
