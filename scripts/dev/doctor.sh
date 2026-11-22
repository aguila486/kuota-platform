#!/usr/bin/env bash
# Verifica el entorno de desarrollo de Kuota (FR-003, US1-4). Las versiones requeridas se leen del repositorio:
#   Node     -> .nvmrc
#   pnpm     -> "packageManager" de package.json
#   Flutter  -> flutter/.fvmrc (cuando exista; lo crea T080)
# Sale con código 1 si algún requisito no se cumple, indicando la versión requerida.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FAILURES=0
ok()   { printf '  \342\234\223 %s\n' "$1"; }
fail() { printf '  \342\234\227 %s\n' "$1"; FAILURES=$((FAILURES + 1)); }
info() { printf '  - %s\n' "$1"; }

version_ge() { # $1 >= $2 (semver numérico)
  [ "$(printf '%s\n%s\n' "$2" "$1" | sort -t. -k1,1n -k2,2n -k3,3n | head -n1)" = "$2" ]
}

echo "Kuota doctor"

# Node.js
REQ_NODE="$(tr -d '[:space:]v' < "$ROOT/.nvmrc")"
if command -v node >/dev/null 2>&1; then
  CUR_NODE="$(node -v | tr -d 'v')"
  if [ "${CUR_NODE%%.*}" = "${REQ_NODE%%.*}" ] && version_ge "$CUR_NODE" "$REQ_NODE"; then
    ok "Node $CUR_NODE (requerido: $REQ_NODE, .nvmrc)"
  else
    fail "Node $CUR_NODE no cumple: se requiere Node $REQ_NODE o superior dentro de la misma versión mayor (.nvmrc). Ejecuta: nvm install && nvm use"
  fi
else
  fail "Node no está instalado: se requiere Node $REQ_NODE (.nvmrc). Ejecuta: nvm install"
fi

# pnpm (vía Corepack)
REQ_PNPM="$(sed -n 's/.*"packageManager": *"pnpm@\([0-9.]*\).*/\1/p' "$ROOT/package.json")"
if command -v pnpm >/dev/null 2>&1; then
  CUR_PNPM="$(cd "$ROOT" && COREPACK_ENABLE_DOWNLOAD_PROMPT=0 pnpm --version 2>/dev/null)"
  if [ "$CUR_PNPM" = "$REQ_PNPM" ]; then
    ok "pnpm $CUR_PNPM (requerido: $REQ_PNPM, packageManager)"
  else
    fail "pnpm ${CUR_PNPM:-desconocido} no cumple: se requiere pnpm $REQ_PNPM (packageManager). Con Node 26: npm i -g corepack && corepack enable pnpm"
  fi
else
  fail "pnpm no está disponible: se requiere pnpm $REQ_PNPM. Con Node 26: npm i -g corepack && corepack enable pnpm"
fi

# Docker y Compose v2
if command -v docker >/dev/null 2>&1; then
  if docker info >/dev/null 2>&1; then
    ok "Docker $(docker version --format '{{.Server.Version}}' 2>/dev/null) (demonio en ejecución)"
  else
    fail "Docker está instalado pero el demonio no responde: inicia Docker Desktop"
  fi
  if docker compose version >/dev/null 2>&1; then
    ok "Docker Compose $(docker compose version --short 2>/dev/null)"
  else
    fail "Docker Compose v2 no está disponible: se requiere 'docker compose' (v2)"
  fi
else
  fail "Docker no está instalado: se requiere Docker con Compose v2"
fi

# FVM y Flutter del proyecto
REQ_FVM="3.2.0"
if command -v fvm >/dev/null 2>&1; then
  CUR_FVM="$(fvm --version 2>/dev/null | head -n1 | tr -d '[:space:]')"
  if version_ge "$CUR_FVM" "$REQ_FVM"; then
    ok "FVM $CUR_FVM (requerido: >= $REQ_FVM)"
  else
    fail "FVM $CUR_FVM no cumple: se requiere FVM >= $REQ_FVM"
  fi
else
  fail "FVM no está instalado: se requiere FVM >= $REQ_FVM (D-ENV-01)"
fi

FVMRC="$ROOT/flutter/.fvmrc"
if [ -f "$FVMRC" ]; then
  REQ_FLUTTER="$(sed -n 's/.*"flutter": *"\([^"]*\)".*/\1/p' "$FVMRC")"
  CUR_FLUTTER="$(cd "$ROOT/flutter" && fvm flutter --version 2>/dev/null | sed -n 's/^Flutter \([0-9.]*\).*/\1/p' | head -n1)"
  if [ -n "$CUR_FLUTTER" ] && [ "$CUR_FLUTTER" = "$REQ_FLUTTER" ]; then
    ok "Flutter $CUR_FLUTTER del proyecto (requerido: $REQ_FLUTTER, flutter/.fvmrc)"
  else
    fail "Flutter del proyecto ${CUR_FLUTTER:-no instalado} no cumple: se requiere $REQ_FLUTTER (flutter/.fvmrc). Ejecuta: cd flutter && fvm install"
  fi
else
  info "flutter/.fvmrc aún no existe (lo crea T080): verificación de Flutter omitida"
fi

if [ "$FAILURES" -gt 0 ]; then
  echo "Resultado: $FAILURES requisito(s) sin cumplir."
  exit 1
fi
echo "Resultado: entorno listo."
