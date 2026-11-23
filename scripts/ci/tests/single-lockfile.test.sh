#!/usr/bin/env bash
# Prueba del verificador de resolución única (T086, US7-1): aprueba el workspace real y una copia correcta, y falla con
# cada defecto de referencia sobre copias temporales (solo pubspec.yaml/pubspec.lock). Sin red, Docker ni Flutter.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
CHECK="$ROOT/scripts/ci/check-single-lockfile.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
FAILED=0
expect() { # nombre esperado obtenido
  if [ "$2" = "$3" ]; then echo "  ✓ $1 → $3"; else echo "  ✗ $1: esperado $2, obtenido $3"; FAILED=$((FAILED + 1)); fi
}
run() { "$CHECK" "$1" >/dev/null 2>&1; echo $?; }
copy() { # copia mínima del workspace real en $TMP/$1
  local dest="$TMP/$1"
  mkdir -p "$dest"
  (cd "$ROOT/flutter" && find . \( -name build -o -name .dart_tool -o -name ephemeral \) -prune -o \
    \( -name pubspec.yaml -o -name pubspec.lock \) -print | while IFS= read -r f; do
      mkdir -p "$dest/$(dirname "$f")" && cp "$f" "$dest/$f"
    done)
  echo "$dest"
}

echo "Resolución única del workspace (scripts/ci/check-single-lockfile.sh)"
expect "workspace real" 0 "$(run "$ROOT/flutter")"
ok="$(copy ok)"
expect "copia correcta" 0 "$(run "$ok")"
d="$(copy lock-en-paquete)"; cp "$d/pubspec.lock" "$d/packages/shared_core/pubspec.lock"
expect "pubspec.lock en un paquete" 1 "$(run "$d")"
d="$(copy lock-en-app)"; cp "$d/pubspec.lock" "$d/apps/client_mobile/pubspec.lock"
expect "pubspec.lock en una app" 1 "$(run "$d")"
d="$(copy lock-en-build)"; mkdir -p "$d/apps/admin_web/build" && cp "$d/pubspec.lock" "$d/apps/admin_web/build/pubspec.lock"
expect "pubspec.lock dentro de build/ (generado, ignorado)" 0 "$(run "$d")"
d="$(copy sin-lock)"; rm "$d/pubspec.lock"
expect "sin pubspec.lock en la raíz" 1 "$(run "$d")"
d="$(copy sin-resolution)"; sed -i.bak '/^resolution: workspace/d' "$d/packages/api_client/pubspec.yaml"
expect "miembro sin resolution: workspace" 1 "$(run "$d")"
d="$(copy no-miembro)"; sed -i.bak '/^  - apps\/collector_mobile/d' "$d/pubspec.yaml"
expect "app con pubspec.yaml fuera de workspace:" 1 "$(run "$d")"
d="$(copy miembro-inexistente)"; LC_ALL=C perl -0pi -e 's/^workspace:\n/workspace:\n  - packages\/no_existe\n/m' "$d/pubspec.yaml"
expect "miembro declarado sin pubspec.yaml" 1 "$(run "$d")"

[ "$FAILED" -eq 0 ] || { echo "  $FAILED caso(s) fallaron"; exit 1; }
