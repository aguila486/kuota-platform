#!/usr/bin/env bash
# Resolución única del workspace Flutter (T086, US7-1; ADR-0003): falla si
#   - hay un `pubspec.lock` distinto de `flutter/pubspec.lock` (versionado o no; se ignoran build/, .dart_tool/ y los
#     directorios `ephemeral/` que genera Flutter);
#   - `flutter/pubspec.lock` no está versionado (solo si el directorio está dentro de un repositorio Git);
#   - un miembro de `workspace:` no declara `resolution: workspace`;
#   - un `pubspec.yaml` de apps/ o packages/ no es miembro de `workspace:` (se resolvería por separado).
# Uso: scripts/ci/check-single-lockfile.sh [directorio-flutter]   (por defecto, flutter/)
# Salida: 0 resolución única; 1 con incumplimientos (se listan todos).
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DIR="${1:-$ROOT/flutter}"
cd "$DIR" || { echo "  ✗ no existe $DIR"; exit 1; }
FAILED=0
fail() { echo "  ✗ $*"; FAILED=1; }
pruned() { find . \( -name build -o -name .dart_tool -o -name ephemeral -o -name .symlinks \) -prune -o "$@" -print; }

[ -f pubspec.lock ] || fail "falta pubspec.lock en la raíz del workspace"
while IFS= read -r lock; do
  [ "$lock" = "./pubspec.lock" ] || fail "lockfile fuera de la raíz: ${lock#./} (cada miembro debe usar el de la raíz)"
done < <(pruned -name pubspec.lock | sort)
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git ls-files --error-unmatch pubspec.lock >/dev/null 2>&1 || fail "pubspec.lock de la raíz no está versionado"
fi

MEMBERS="$(awk '/^workspace:[[:space:]]*$/ {w = 1; next} w && /^[[:space:]]+-[[:space:]]/ {sub(/^[[:space:]]+-[[:space:]]+/, ""); sub(/[[:space:]]+(#.*)?$/, ""); print; next} w && /^[^[:space:]#]/ {w = 0}' pubspec.yaml 2>/dev/null)"
[ -n "$MEMBERS" ] || fail "pubspec.yaml de la raíz sin miembros en workspace:"
while IFS= read -r member; do
  [ -n "$member" ] || continue
  if [ ! -f "$member/pubspec.yaml" ]; then
    fail "miembro $member sin pubspec.yaml"
  elif ! grep -qE '^resolution:[[:space:]]*workspace[[:space:]]*$' "$member/pubspec.yaml"; then
    fail "miembro $member sin 'resolution: workspace'"
  fi
done <<<"$MEMBERS"
for area in apps packages; do
  [ -d "$area" ] || continue
  while IFS= read -r pubspec; do
    member="$(dirname "${pubspec#./}")"
    grep -qxF "$member" <<<"$MEMBERS" || fail "$member tiene pubspec.yaml pero no es miembro de workspace:"
  done < <(cd . && find "$area" \( -name build -o -name .dart_tool -o -name ephemeral -o -name .symlinks \) -prune -o -name pubspec.yaml -print | sort)
done

if [ "$FAILED" -eq 0 ]; then
  echo "  ✓ un solo pubspec.lock (raíz) para $(grep -c . <<<"$MEMBERS") miembros con resolution: workspace"
fi
exit "$FAILED"
