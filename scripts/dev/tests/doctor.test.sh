#!/usr/bin/env bash
# Prueba automática de scripts/dev/doctor.sh (T107; US1-4, FR-003) con binarios SIMULADOS en el PATH: node, pnpm, docker
# y fvm son scripts temporales que devuelven la versión configurada para cada caso. Las versiones requeridas se leen de
# los mismos archivos que doctor.sh (.nvmrc, packageManager, flutter/.fvmrc), nunca se fijan aquí.
#   - Control: todo en la versión requerida → exit 0 y "entorno listo".
#   - Cada requisito incumplido por separado → exit 1, "1 requisito(s) sin cumplir" y un mensaje que NOMBRA la versión
#     requerida (o el requisito, para el demonio de Docker y Compose).
# No usa las herramientas reales del sistema: el PATH solo contiene los simulados y utilidades POSIX de /usr/bin y /bin.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "${TMP:?}"' EXIT
FAILED=0

REQ_NODE="$(tr -d '[:space:]v' <"$ROOT/.nvmrc")"
REQ_PNPM="$(sed -n 's/.*"packageManager": *"pnpm@\([0-9.]*\).*/\1/p' "$ROOT/package.json")"
REQ_FLUTTER="$(sed -n 's/.*"flutter": *"\([^"]*\)".*/\1/p' "$ROOT/flutter/.fvmrc")"
REQ_FVM="3.2.0"
[ -n "$REQ_NODE" ] && [ -n "$REQ_PNPM" ] && [ -n "$REQ_FLUTTER" ] || { echo "  ✗ no se pudieron leer las versiones requeridas"; exit 1; }

# fakes DIR node pnpm fvm flutter docker-daemon(up|down) compose(yes|no); "" = binario ausente.
fakes() {
  local dir="$1" node="$2" pnpm="$3" fvm="$4" flutter="$5" daemon="$6" compose="$7"
  mkdir -p "$dir"
  [ -n "$node" ] && printf '#!/bin/sh\n[ "$1" = "-v" ] && echo "v%s"\n' "$node" >"$dir/node"
  [ -n "$pnpm" ] && printf '#!/bin/sh\n[ "$1" = "--version" ] && echo "%s"\n' "$pnpm" >"$dir/pnpm"
  [ -n "$fvm" ] && printf '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "%s"; exit 0; fi\nif [ "$1" = "flutter" ] && [ "$2" = "--version" ]; then echo "Flutter %s • channel stable"; echo "Dart 3.14.0"; fi\n' "$fvm" "$flutter" >"$dir/fvm"
  cat >"$dir/docker" <<SH
#!/bin/sh
case "\$1" in
  info) [ "$daemon" = up ] ;;
  version) echo "29.0.0" ;;
  compose) [ "$compose" = yes ] && echo "v2.40.0" || exit 1 ;;
esac
SH
  chmod +x "$dir"/*
}

case_() { # nombre exit-esperado texto-esperado node pnpm fvm flutter daemon compose
  local name="$1" expected="$2" text="$3" dir="$TMP/$4-$5-$6-$7-$8-$9-$RANDOM" output status
  fakes "$dir" "$4" "$5" "$6" "$7" "$8" "$9"
  output="$(PATH="$dir:/usr/bin:/bin" bash "$ROOT/scripts/dev/doctor.sh" 2>&1)"
  status=$?
  local failures_ok=1
  if [ "$expected" -eq 1 ]; then grep -q "Resultado: 1 requisito(s) sin cumplir." <<<"$output" || failures_ok=0; fi
  if [ "$status" -eq "$expected" ] && grep -qF -- "$text" <<<"$output" && [ "$failures_ok" -eq 1 ]; then
    echo "  ✓ $name → exit $status"
  else
    echo "  ✗ $name: se esperaba exit $expected con '$text', se obtuvo exit $status"
    echo "$output" | sed 's/^/      /'
    FAILED=$((FAILED + 1))
  fi
}

NODE_MAJOR="${REQ_NODE%%.*}"
echo "doctor.sh con binarios simulados (requeridos: Node $REQ_NODE, pnpm $REQ_PNPM, FVM >= $REQ_FVM, Flutter $REQ_FLUTTER)"
case_ "control: todo en la versión requerida" 0 "Resultado: entorno listo." \
  "$REQ_NODE" "$REQ_PNPM" "$REQ_FVM" "$REQ_FLUTTER" up yes
case_ "Node de otra versión mayor" 1 "se requiere Node $REQ_NODE" \
  "$((NODE_MAJOR - 2)).0.0" "$REQ_PNPM" "$REQ_FVM" "$REQ_FLUTTER" up yes
case_ "Node de la misma mayor pero anterior a la requerida" 1 "se requiere Node $REQ_NODE" \
  "$NODE_MAJOR.0.0" "$REQ_PNPM" "$REQ_FVM" "$REQ_FLUTTER" up yes
case_ "Node ausente" 1 "Node no está instalado: se requiere Node $REQ_NODE" \
  "" "$REQ_PNPM" "$REQ_FVM" "$REQ_FLUTTER" up yes
case_ "pnpm de otra versión" 1 "se requiere pnpm $REQ_PNPM" \
  "$REQ_NODE" "9.0.0" "$REQ_FVM" "$REQ_FLUTTER" up yes
case_ "pnpm ausente" 1 "pnpm no está disponible: se requiere pnpm $REQ_PNPM" \
  "$REQ_NODE" "" "$REQ_FVM" "$REQ_FLUTTER" up yes
case_ "demonio de Docker detenido" 1 "el demonio no responde" \
  "$REQ_NODE" "$REQ_PNPM" "$REQ_FVM" "$REQ_FLUTTER" down yes
case_ "Docker Compose v2 ausente" 1 "se requiere 'docker compose' (v2)" \
  "$REQ_NODE" "$REQ_PNPM" "$REQ_FVM" "$REQ_FLUTTER" up no
case_ "FVM anterior a la mínima" 1 "se requiere FVM >= $REQ_FVM" \
  "$REQ_NODE" "$REQ_PNPM" "3.1.9" "$REQ_FLUTTER" up yes
case_ "Flutter del proyecto en otra versión" 1 "se requiere $REQ_FLUTTER (flutter/.fvmrc)" \
  "$REQ_NODE" "$REQ_PNPM" "$REQ_FVM" "3.49.0" up yes

# Docker ausente (sin el simulado): exit 1 y requisito nombrado.
dir="$TMP/sin-docker"
fakes "$dir" "$REQ_NODE" "$REQ_PNPM" "$REQ_FVM" "$REQ_FLUTTER" up yes
rm -f "${dir:?}/docker"
output="$(PATH="$dir:/usr/bin:/bin" bash "$ROOT/scripts/dev/doctor.sh" 2>&1)"
status=$?
if [ "$status" -eq 1 ] && grep -qF "Docker no está instalado: se requiere Docker con Compose v2" <<<"$output"; then
  echo "  ✓ Docker ausente → exit 1"
else
  echo "  ✗ Docker ausente: se esperaba exit 1 con el requisito nombrado, se obtuvo exit $status"
  FAILED=$((FAILED + 1))
fi

[ "$FAILED" -eq 0 ] && echo "Resultado: doctor.sh falla y nombra la versión requerida en cada caso." || echo "Resultado: $FAILED caso(s) fallaron."
exit "$FAILED"
