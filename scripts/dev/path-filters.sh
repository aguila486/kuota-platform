# Filtros por ruta de los componentes (FR-002). Fuente única para test-affected.sh y para el CI de G12
# (docs/architecture/monorepo-strategy.md §4, docs/architecture/deployment-architecture.md, R-17).
# Una entrada terminada en "/" es un directorio (prefijo); cualquier otra es un archivo exacto.
# backend: también los roles y el aprovisionamiento de PostgreSQL (infra/docker/: 01/02-*.sql, compose) y la
# configuración del workspace, porque cambian lo que validan las pruebas con PostgreSQL y db:check-rls (G12).
FILTER_backend=(backend/ contracts/ pnpm-lock.yaml pnpm-workspace.yaml package.json infra/docker/)
# contracts: también las herramientas del contrato (scripts/contracts/) y el package.json raíz que las fija.
FILTER_contracts=(contracts/ scripts/contracts/ package.json)
FILTER_flutter=(flutter/ contracts/)
# Cambios que disparan la suite completa (docs/quality/testing-strategy.md): contrato, Constitución, configuración de
# CI y sus filtros (un cambio en el propio pipeline se valida con todos los jobs).
FULL_SUITE=(contracts/ .specify/memory/ .github/workflows/ .github/CODEOWNERS scripts/ci/ scripts/dev/path-filters.sh)
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
