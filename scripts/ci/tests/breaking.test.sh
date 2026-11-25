#!/usr/bin/env bash
# T068 (US5; FR-028; R-13): eliminar un campo requerido de `CompatibilityInfo` en una COPIA TEMPORAL del contrato hace
# fallar `scripts/contracts/breaking.sh`. T103: también eliminar un campo OPCIONAL de una respuesta (2xx y de error).
# Sin modificar el contrato del repositorio.
#
# Casos:
#   1. Control: una copia sin cambios → exit 0 (la comparación funciona y no hay falsos positivos).
#   2. `api_version` eliminado de `properties` y de `required` en la copia → exit 1 exactamente (un 2 sería un error de
#      entorno, no una detección) con la regla de oasdiff `response-required-property-removed`.
#   3. T103: `client_supported` (opcional en la respuesta 200 de /v1/meta/compatibility) eliminado → exit 1 con
#      `response-optional-property-removed` (oasdiff lo clasifica `info`; breaking.sh lo eleva a ERR).
#   4. T103: `detail` (opcional en Problem, respuestas de error) eliminado → exit 1 con la misma regla.
#   5. T103: sin la lista de niveles propios, oasdiff NO bloquea la variante 3 (prueba que la detección depende de ella).
#   6. El contrato del repositorio no cambia (huella antes y después).
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

for copy in base revision optional-200 optional-error; do
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

# T103: elimina un campo OPCIONAL de una respuesta en las copias `optional-200` y `optional-error`.
remove_optional() { # archivo campo
  python3 - "$1" "$2" <<'PY'
import sys, yaml
path, field = sys.argv[1], sys.argv[2]
schema = yaml.safe_load(open(path))
assert field in schema['properties'] and field not in schema.get('required', []), f'{field} ya no es opcional'
del schema['properties'][field]
yaml.safe_dump(schema, open(path, 'w'), sort_keys=False, allow_unicode=True)
PY
}
remove_optional "$WORK/optional-200/contracts/openapi/schemas/CompatibilityInfo.yaml" client_supported
remove_optional "$WORK/optional-error/contracts/openapi/schemas/Problem.yaml" detail

bundle() { # copia salida
  (cd "$ROOT" && pnpm exec redocly bundle "$WORK/$1/contracts/openapi/kuota-core.v1.yaml" \
    --config "$WORK/$1/contracts/openapi/redocly.yaml" -o "$2" >/dev/null 2>&1)
}
bundle base "$WORK/base.yaml" || { echo "  ✗ no se pudo empaquetar la copia base"; exit 1; }
bundle revision "$WORK/revision.yaml" || { echo "  ✗ no se pudo empaquetar la copia modificada"; exit 1; }
bundle optional-200 "$WORK/optional-200.yaml" || { echo "  ✗ no se pudo empaquetar la copia optional-200"; exit 1; }
bundle optional-error "$WORK/optional-error.yaml" || { echo "  ✗ no se pudo empaquetar la copia optional-error"; exit 1; }

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

echo "Campo opcional eliminado de una respuesta (T103)"
check "client_supported eliminado (opcional en la respuesta 200 de /v1/meta/compatibility)" \
  "$WORK/base.yaml" "$WORK/optional-200.yaml" 1 "response-optional-property-removed"
check "detail eliminado (opcional en Problem, respuestas de error)" \
  "$WORK/base.yaml" "$WORK/optional-error.yaml" 1 "response-optional-property-removed"

# Sin la lista de niveles propios, oasdiff 1.39.0 no lo bloquea: la detección depende de esa configuración.
OASDIFF_IMAGE="$(sed -n 's/^OASDIFF_IMAGE="\(.*\)"$/\1/p' "$ROOT/scripts/contracts/breaking.sh")"
docker run --rm --network none -v "$WORK:/w:ro" "$OASDIFF_IMAGE" breaking /w/base.yaml /w/optional-200.yaml \
  --fail-on WARN --format text >/dev/null 2>&1
default_status=$?
if [ -n "$OASDIFF_IMAGE" ] && [ "$default_status" -eq 0 ]; then
  echo "  ✓ sin la lista de niveles propios, oasdiff (incluso con --fail-on WARN) no lo bloquea → exit 0"
else
  echo "  ✗ comportamiento por defecto de oasdiff inesperado (exit $default_status): revisar la lista de niveles"
  FAILED=$((FAILED + 1))
fi

if [ "$(fingerprint)" = "$BEFORE" ]; then
  echo "  ✓ el contrato del repositorio no cambió"
else
  echo "  ✗ el contrato del repositorio cambió durante la prueba"
  FAILED=$((FAILED + 1))
fi

[ "$FAILED" -eq 0 ] && echo "Resultado: breaking.sh detecta los campos requeridos y opcionales eliminados de respuestas." || echo "Resultado: $FAILED caso(s) fallaron."
exit "$FAILED"
