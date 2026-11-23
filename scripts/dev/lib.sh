# Funciones comunes de scripts/dev (se importa con `source`; no se ejecuta sola).
KUOTA_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
KUOTA_STATE_DIR="$KUOTA_ROOT/.dev"

step() { printf '\n==> %s\n' "$1"; }
note() { printf '    %s\n' "$1"; }
die() { printf '\n\342\234\227 %s\n' "$1" >&2; shift; for line in "$@"; do printf '  %s\n' "$line" >&2; done; exit 1; }

# true si algo escucha en 127.0.0.1:<puerto> (bash puro, sin lsof/nc).
port_in_use() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }

# Termina un proceso y todos sus descendientes (nest --watch crea procesos hijos).
kill_tree() {
  local pid="$1" child
  for child in $(pgrep -P "$pid" 2>/dev/null); do kill_tree "$child"; done
  kill -TERM "$pid" 2>/dev/null || true
}

# Carga un archivo .env en el entorno del script (sin imprimir valores).
load_env_file() {
  set -a
  # shellcheck disable=SC1090
  . "$1"
  set +a
}

kuota_compose() {
  docker compose -p "$KUOTA_COMPOSE_PROJECT" -f "$KUOTA_ROOT/infra/docker/compose.yaml" --env-file "$KUOTA_ENV_FILE" "$@"
}
