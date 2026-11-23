#!/usr/bin/env bash
# T068 (US5; FR-028; R-13): eliminar un campo requerido de `CompatibilityInfo` en una COPIA TEMPORAL del contrato hace
# fallar `scripts/contracts/breaking.sh`. Sin modificar el contrato del repositorio.
#
# Casos:
#   1. Control: una copia sin cambios → exit 0 (la comparación funciona y no hay falsos positivos).
#   2. `api_version` eliminado de `properties` y de `required` en la copia → exit 1 exactamente (un 2 sería un error de
#      entorno, no una detección) con la regla de oasdiff `response-required-property-removed`.
#   3. El contrato del repositorio no cambia (huella antes y después).
# Requiere Docker (oasdiff fijado por digest en breaking.sh) y el toolchain de Node del proyecto (Redocly).
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
source "$ROOT/scripts/ci/lib.sh"
use_project_node
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
FAILED=0
fingerprint() { (cd "$ROOT" && find contracts/openapi -type f -not -path '*/dist/*' -print0 | sort -z | LC_ALL=C xargs -0 shasum -a 256 | LC_ALL=C shasum -a 256); }
BEFORE="$(fingerprint)"

for copy in base revision; do
  mkdir -p "$WORK/$copy/contracts"
  cp -R "$ROOT/contracts/openapi" "$WORK/$copy/contracts/openapi"
  rm -rf "$WORK/$copy/contracts/openapi/dist"
done

# Elimina el campo requerido `api_version` de CompatibilityInfo solo en la copia `revision`.
python3 - "$WORK/revision/contracts/openapi/schemas/CompatibilityInfo.yaml" <<'PY'
import sys, yaml
path = sys.argv[1]
schema = yaml.safe_load(open(path))
assert 'api_version' in schema['required'] and 'api_version' in schema['properties'], 'api_version ya no es requerido'
schema['required'].remove('api_version')
del schema['properties']['api_version']
yaml.safe_dump(schema, open(path, 'w'), sort_keys=False, allow_unicode=True)
PY

bundle() { # copia salida
  (cd "$ROOT" && pnpm exec redocly bundle "$WORK/$1/contracts/openapi/kuota-core.v1.yaml" \
    --config "$WORK/$1/contracts/openapi/redocly.yaml" -o "$2" >/dev/null 2>&1)
}
bundle base "$WORK/base.yaml" || { echo "  ✗ no se pudo empaquetar la copia base"; exit 1; }
bundle revision "$WORK/revision.yaml" || { echo "  ✗ no se pudo empaquetar la copia modificada"; exit 1; }

check() { # nombre base revisión exit-esperado texto-esperado
  local output status
  output="$("$ROOT/scripts/contracts/breaking.sh" --files "$2" "$3" 2>&1)"
  status=$?
  if [ "$status" -eq "$4" ] && { [ -z "$5" ] || grep -q -- "$5" <<<"$output"; }; then
    echo "  ✓ $1 → exit $status${5:+ ($5)}"
  else
    echo "  ✗ $1: se esperaba exit $4${5:+ con '$5'}, se obtuvo exit $status"
    echo "$output" | head -8 | sed 's/^/      /'
    FAILED=$((FAILED + 1))
  fi
}

echo "Detección de cambios incompatibles: campo requerido eliminado de CompatibilityInfo (T068)"
check "control: copia sin cambios" "$WORK/base.yaml" "$WORK/base.yaml" 0 ""
check "api_version eliminado (requerido en la respuesta de /v1/meta/compatibility)" \
  "$WORK/base.yaml" "$WORK/revision.yaml" 1 "response-required-property-removed"

if [ "$(fingerprint)" = "$BEFORE" ]; then
  echo "  ✓ el contrato del repositorio no cambió"
else
  echo "  ✗ el contrato del repositorio cambió durante la prueba"
  FAILED=$((FAILED + 1))
fi

[ "$FAILED" -eq 0 ] && echo "Resultado: breaking.sh detecta el campo requerido eliminado." || echo "Resultado: $FAILED caso(s) fallaron."
exit "$FAILED"
