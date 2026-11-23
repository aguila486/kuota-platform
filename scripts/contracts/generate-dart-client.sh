#!/usr/bin/env bash
# Genera el cliente Dart de Kuota Core desde el contrato (T069, T070; R-12; FR-029; FR-040).
#
#   1. Bundle de CLIENTE (`pnpm contracts:bundle:client`): el contrato fuente sin las rutas ni operaciones
#      `x-kuota-non-production: true` (dev-probe) ni sus componentes (decoradores `filter-out` y
#      `remove-unused-components` de la API `client` en contracts/openapi/redocly.yaml). Se verifica que no quede ninguna
#      ruta, operación, esquema ni esquema de seguridad técnicos; si queda alguno, falla sin generar.
#   2. openapi-generator `dart-dio` desde su imagen oficial fijada por digest, sin red y con el usuario local.
#   3. Posprocesado determinista (parte del script, no un parche manual): el código generado se coloca en
#      flutter/packages/api_client/lib/src/generated/ y sus imports `package:api_client/src/…` se reescriben a
#      `package:api_client/src/generated/…`. La biblioteca generada se renombra a `generated.dart` porque
#      `lib/api_client.dart` es la API pública escrita a mano (T070).
#   4. `build_runner` (built_value) genera los `.g.dart` y `dart format` los formatea con el ancho del workspace.
#   5. Comprobación final: el código generado no contiene operaciones ni modelos de dev-probe.
# El resultado se versiona. T071 añadirá a CI la comprobación "regenerado == versionado".
#
# Requiere Docker, el toolchain de Node del proyecto (Redocly) y FVM con el Flutter de flutter/.fvmrc.
# Salida: 0 generado; 1 fallo (bundle con operaciones técnicas, generación, compilación o código prohibido).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$ROOT/scripts/ci/lib.sh"
use_project_node

# Imagen oficial fijada por digest (índice multiarquitectura linux/amd64 y linux/arm64), verificada el 2026-11-23 con
# `docker buildx imagetools inspect openapitools/openapi-generator-cli:v7.27.0`.
GENERATOR_IMAGE="openapitools/openapi-generator-cli:v7.27.0@sha256:949efd0d5cf3c093ef169887b2ebe0879ee2e8074b6476264232ce4fd8ef46d0"
BUNDLE="$ROOT/contracts/openapi/dist/kuota-core.v1.client.bundle.yaml"
PACKAGE="$ROOT/flutter/packages/api_client"
TARGET="$PACKAGE/lib/src/generated"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

require_docker
command -v fvm >/dev/null 2>&1 || die "Se requiere FVM (flutter/.fvmrc) para compilar el cliente generado."

step "1/5 Bundle de cliente sin operaciones técnicas"
(cd "$ROOT" && pnpm --silent contracts:bundle:client >/dev/null)
python3 - "$BUNDLE" <<'PY'
import sys, yaml
doc = yaml.safe_load(open(sys.argv[1]))
problems = []
for path, item in doc.get('paths', {}).items():
    if '/dev/' in path or item.get('x-kuota-non-production'):
        problems.append(f'ruta técnica {path}')
    for method, op in item.items():
        if isinstance(op, dict) and (op.get('x-kuota-non-production') or 'dev-probe' in op.get('tags', [])):
            problems.append(f'operación técnica {method.upper()} {path}')
components = doc.get('components', {})
problems += [f'esquema técnico {n}' for n in components.get('schemas', {}) if n.lower().startswith('devprobe')]
problems += [f'seguridad técnica {n}' for n in components.get('securitySchemes', {}) if 'dev' in n.lower()]
problems += [f'parámetro técnico {n}' for n in components.get('parameters', {}) if n.lower().startswith('dev')]
if problems:
    print('  ✗ el bundle de cliente contiene elementos técnicos: ' + '; '.join(problems))
    sys.exit(1)
print(f"    rutas: {', '.join(doc['paths'])}")
PY

step "2/5 openapi-generator dart-dio (imagen fijada por digest, sin red)"
mkdir -p "$WORK/in" "$WORK/out"
cp "$BUNDLE" "$WORK/in/client.yaml"
docker run --rm --network none -u "$(id -u):$(id -g)" -v "$WORK:/w" "$GENERATOR_IMAGE" generate \
  -i /w/in/client.yaml -g dart-dio -o /w/out \
  --additional-properties=pubName=api_client,serializationLibrary=built_value,dateLibrary=core,hideGenerationTimestamp=true \
  >"$WORK/generator.log" 2>&1 || {
  tail -20 "$WORK/generator.log"
  die "openapi-generator falló"
}

step "3/5 Posprocesado determinista hacia lib/src/generated/"
rm -rf "$TARGET"
mkdir -p "$TARGET"
cp -R "$WORK/out/lib/src/." "$TARGET/"
cp "$WORK/out/lib/api_client.dart" "$TARGET/generated.dart"
find "$TARGET" -name '*.dart' -print0 | while IFS= read -r -d '' file; do
  LC_ALL=C perl -pi -e \
    's{package:api_client/api_client\.dart}{package:api_client/src/generated/generated.dart}g; s{package:api_client/src/(?!generated/)}{package:api_client/src/generated/}g' \
    "$file"
done

step "4/5 build_runner (built_value) y formato"
(cd "$ROOT/flutter" && fvm dart pub get >/dev/null)
(cd "$PACKAGE" && fvm dart run build_runner build --delete-conflicting-outputs >"$WORK/build_runner.log" 2>&1) || {
  tail -20 "$WORK/build_runner.log"
  die "build_runner falló"
}
(cd "$ROOT/flutter" && fvm dart format "$TARGET" >/dev/null)

step "5/5 El código generado no contiene operaciones ni modelos técnicos"
if grep -rliE "dev_?probe|devtenantcontext|/v1/dev/|x-kuota-dev" "$TARGET" >"$WORK/leaks.txt"; then
  sed 's#^#  ✗ #' "$WORK/leaks.txt"
  die "el cliente generado contiene referencias técnicas (dev-probe)"
fi
note "cliente generado en ${TARGET#"$ROOT"/} ($(find "$TARGET" -name '*.dart' | wc -l | tr -d ' ') archivos Dart)"
