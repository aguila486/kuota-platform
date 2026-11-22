#!/usr/bin/env bash
# Detección de cambios incompatibles del contrato (T024; R-13; FR-028) con oasdiff 1.39.0 en Docker.
#
#   scripts/contracts/breaking.sh [REF]            compara el contrato de la rama actual con el de REF (por defecto main)
#   scripts/contracts/breaking.sh --files BASE REV compara dos archivos OpenAPI ya empaquetados (pruebas)
#
# Sale con 0 si no hay cambios incompatibles, 1 si los hay (nivel ERR) y 2 ante un error de uso o de entorno.
# Si REF no contiene todavía el contrato (primera introducción), no hay versión base contra la cual comparar: lo
# informa y sale con 0. La base nunca se inventa; existirá cuando el contrato llegue a REF por PR.
set -euo pipefail

# Imagen oficial fijada por digest (índice multiarquitectura: linux/amd64 y linux/arm64), verificada el 2026-11-22 con
# `docker buildx imagetools inspect tufin/oasdiff:v1.39.0` y `oasdiff --version` = v1.39.0.
OASDIFF_IMAGE="tufin/oasdiff:v1.39.0@sha256:004bef22058ace818b61f0eb2f05efb89fc6a3882f68bf4db0b6a86f40723fe0"
CONTRACT_DIR="contracts/openapi"
CONTRACT_ROOT="$CONTRACT_DIR/kuota-core.v1.yaml"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

command -v docker >/dev/null 2>&1 || { echo "breaking.sh: se requiere Docker para ejecutar oasdiff" >&2; exit 2; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

bundle() { # directorio-con-contracts/openapi salida
  (cd "$ROOT" && pnpm exec redocly bundle "$1/$CONTRACT_ROOT" --config "$1/$CONTRACT_DIR/redocly.yaml" -o "$2" >/dev/null)
}

oasdiff_breaking() { # base revisión (rutas absolutas)
  local base_dir rev_dir
  base_dir="$(cd "$(dirname "$1")" && pwd)"; rev_dir="$(cd "$(dirname "$2")" && pwd)"
  docker run --rm --network none \
    -v "$base_dir:/base:ro" -v "$rev_dir:/revision:ro" \
    "$OASDIFF_IMAGE" breaking "/base/$(basename "$1")" "/revision/$(basename "$2")" --fail-on ERR --format text
}

if [ "${1:-}" = "--files" ]; then
  [ $# -eq 3 ] || { echo "uso: $0 --files BASE REVISION" >&2; exit 2; }
  oasdiff_breaking "$(cd "$(dirname "$2")" && pwd)/$(basename "$2")" "$(cd "$(dirname "$3")" && pwd)/$(basename "$3")"
  exit $?
fi

REF="${1:-main}"
git -C "$ROOT" rev-parse --verify --quiet "$REF^{commit}" >/dev/null || { echo "breaking.sh: la referencia '$REF' no existe" >&2; exit 2; }

if ! git -C "$ROOT" cat-file -e "$REF:$CONTRACT_ROOT" 2>/dev/null; then
  echo "breaking.sh: '$REF' no contiene $CONTRACT_ROOT; no existe versión base publicada contra la cual comparar."
  echo "breaking.sh: primera introducción del contrato: no se evalúan cambios incompatibles."
  exit 0
fi

mkdir -p "$WORK/base-tree" "$WORK/base" "$WORK/revision"
git -C "$ROOT" archive "$REF" "$CONTRACT_DIR" | tar -x -C "$WORK/base-tree"
bundle "$WORK/base-tree" "$WORK/base/kuota-core.v1.yaml"
bundle "$ROOT" "$WORK/revision/kuota-core.v1.yaml"
echo "breaking.sh: comparando $CONTRACT_ROOT de '$REF' con el árbol de trabajo"
oasdiff_breaking "$WORK/base/kuota-core.v1.yaml" "$WORK/revision/kuota-core.v1.yaml"
